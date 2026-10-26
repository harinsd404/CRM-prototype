import asyncio
import logging
from abc import ABC, abstractmethod
from functools import lru_cache
from typing import Any, ClassVar

from pydantic import BaseModel

from app.config import settings
from app.core.prompts import load_prompt
from app.core.state import MAIN_SLOT, Option, RunState, SlotState
from app.llm import get_chat_model

logger = logging.getLogger(__name__)

GENERATE_ATTEMPTS = 3
RETRY_BACKOFF = 5  # 초. 두 번째 시도는 5초, 세 번째는 10초 뒤


def with_feedback(angle: str, feedback: str | None) -> str:
    """사람의 수정 요청을 안의 방향(angle) 뒤에 붙인다. 모든 단계 프롬프트가 {angle}을 쓰므로 프롬프트를 바꾸지 않아도 된다."""
    if not feedback:
        return angle
    return f"{angle}\n\n[사람의 수정 요청 — 위 방향보다 우선해 반드시 반영]\n{feedback}"


class Step(ABC):
    """모든 단계의 공통 틀.

    단계는 슬롯 1개 이상으로 이루어지고, 슬롯마다 방향(angle)이 다른 N개 안을 병렬로 만든 뒤 사람이 1개를 고른다.
    POD·카피 단계는 슬롯이 하나(main), 이미지 단계는 Pod마다 슬롯이 하나씩이다.
    """

    name: ClassVar[str]
    schema: ClassVar[type[BaseModel]]
    # 안마다 다른 방향을 줘서 N개 안이 서로 달라지게 한다. N이 더 크면 순환한다.
    angles: ClassVar[list[str]]

    def slots(self, run: RunState) -> list[str]:
        return [MAIN_SLOT]

    @abstractmethod
    def build_context(self, run: RunState, slot: str) -> dict[str, str]:
        """앞 단계에서 선택된 결과로 프롬프트 변수를 만든다."""

    @abstractmethod
    async def generate_option(
        self, run: RunState, slot: str, context: dict[str, str], angle: str, index: int
    ) -> BaseModel:
        """안 하나를 만든다."""

    def postprocess(self, run: RunState, slot: str, content: BaseModel) -> list[str]:
        """원본 프롬프트의 규칙을 코드로 검사한다. 확정적으로 고칠 수 있는 값은 content를 직접 고치고,
        사람이 판단할 위반은 경고 문구로 돌려준다."""
        return []

    async def generate_slot(self, run: RunState, slot: str, feedback: str | None = None) -> SlotState:
        context = self.build_context(run, slot)
        angles = [self.angles[i % len(self.angles)] for i in range(settings.num_options)]
        results = await asyncio.gather(
            *(
                self._generate_with_retry(run, slot, context, with_feedback(angle, feedback), i)
                for i, angle in enumerate(angles)
            ),
            return_exceptions=True,
        )
        # 일부 안만 실패하면 성공한 안으로 보여준다. 모두 실패했을 때만 단계 실패.
        succeeded = [(a, r) for a, r in zip(angles, results) if not isinstance(r, BaseException)]
        if not succeeded:
            raise next(r for r in results if isinstance(r, BaseException))
        label = (lambda a: f"{a} · 요청: {feedback}") if feedback else (lambda a: a)
        return SlotState(options=[self.make_option(run, slot, label(a), r) for a, r in succeeded])

    async def _generate_with_retry(
        self, run: RunState, slot: str, context: dict[str, str], angle: str, index: int
    ) -> BaseModel:
        """모델 응답이 가끔 스키마를 어기거나 일시 오류가 나므로, 안 하나가 실패하면 그 안만 다시 시도한다."""
        for attempt in range(1, GENERATE_ATTEMPTS + 1):
            try:
                return await self.generate_option(run, slot, context, angle, index)
            except Exception:
                if attempt == GENERATE_ATTEMPTS:
                    raise
                logger.warning("%s/%s 안 %d 생성 실패, 다시 시도합니다", self.name, slot, index + 1, exc_info=True)
                await asyncio.sleep(RETRY_BACKOFF * attempt)  # 할당량 초과(429)는 잠깐 기다려야 풀린다
        raise AssertionError("unreachable")

    async def generate(self, run: RunState, slots: list[str], feedback: str | None = None) -> dict[str, SlotState]:
        states = await asyncio.gather(*(self.generate_slot(run, slot, feedback) for slot in slots))
        return dict(zip(slots, states))

    def make_option(self, run: RunState, slot: str, angle: str, content: BaseModel) -> Option:
        warnings = self.postprocess(run, slot, content)
        return Option(angle=angle, content=content.model_dump(), warnings=warnings)

    def make_edited_option(self, run: RunState, slot: str, angle: str, edited: dict[str, Any]) -> Option:
        """사람이 고친 내용도 같은 스키마·규칙으로 검사한다. 형식이 틀리면 ValidationError."""
        return self.make_option(run, slot, angle, self.schema.model_validate(edited))


class TextStep(Step):
    """prompts/{prompt_name}.md + 구조화 출력으로 안을 만드는 단계."""

    prompt_name: ClassVar[str]

    @abstractmethod
    def mock_option(self, run: RunState, slot: str, angle: str, index: int) -> BaseModel:
        """LLM_PROVIDER=mock일 때 돌려줄 예시 안."""

    async def generate_option(
        self, run: RunState, slot: str, context: dict[str, str], angle: str, index: int
    ) -> BaseModel:
        if settings.llm_provider == "mock":
            return self.mock_option(run, slot, angle, index)
        return await invoke_structured(self.prompt_name, self.schema, {**context, "angle": angle})


@lru_cache
def _llm_slots() -> asyncio.Semaphore:
    return asyncio.Semaphore(settings.llm_concurrency)


async def invoke_structured(prompt_name: str, schema: type[BaseModel], variables: dict[str, str]) -> BaseModel:
    # json_schema 방식이면 서버(Vertex, vLLM)가 JSON 형식을 강제한다 (형식 깨짐 방지).
    model = get_chat_model().with_structured_output(schema, method="json_schema")
    chain = load_prompt(prompt_name) | model
    async with _llm_slots():
        # 클라이언트 timeout만으로는 멈춘 요청이 끊기지 않았다 (실측: 15건 중 2건이 50분 넘게 대기).
        return await asyncio.wait_for(chain.ainvoke(variables), settings.llm_timeout)
