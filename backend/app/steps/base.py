import asyncio
import logging
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from functools import lru_cache
from typing import Any, ClassVar, TypeVar

from pydantic import BaseModel

from app.config import settings
from app.core.prompts import load_prompt
from app.core.state import MAIN_SLOT, Option, RunState, SlotState
from app.llm import get_chat_model

logger = logging.getLogger(__name__)

T = TypeVar("T")

# 안 하나가 끝날 때마다 부른다 (슬롯 이름, 만든 안 또는 끝내 실패하면 None, 실패 이유)
OnOption = Callable[[str, Option | None, str | None], None]


def failure_reason(error: BaseException) -> str:
    """끝내 실패한 안의 이유를 사람이 읽을 말로. 원인별로 할 일이 달라서 나눈다 (기다리기 / 연출 바꾸기 / 사진 넣기)."""
    text = str(error)
    if isinstance(error, TimeoutError | asyncio.TimeoutError):
        return "응답 시간 초과 (모델이 오래 응답하지 않음)"
    if "429" in text or "RESOURCE_EXHAUSTED" in text:
        return "모델 사용량 초과(429) — 잠시 뒤 다시 생성"
    if "이미지가 생성되지 않았습니다" in text:
        return f"{text[:150]} (안전 필터나 연출 문제일 수 있음)"
    return text[:200] or type(error).__name__

GENERATE_ATTEMPTS = 3
RETRY_BACKOFF = 5  # 초. 두 번째 시도는 5초, 세 번째는 10초 뒤


def option_label(angle: str, feedback: str | None) -> str:
    """화면에 보이는 안 이름. 수정 요청이 있으면 함께 적는다."""
    return f"{angle} · 요청: {feedback}" if feedback else angle


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

    def check_output(self, run: RunState, slot: str, content: BaseModel) -> None:
        """출력이 다음 단계를 깨뜨리면(예: 입력에 없는 Pod 이름) ValueError. 생성 중이면 그 안을 다시 만들고,
        사람이 고친 내용이면 거절한다."""

    def postprocess(self, run: RunState, slot: str, content: BaseModel) -> list[str]:
        """원본 프롬프트의 규칙을 코드로 검사한다. 확정적으로 고칠 수 있는 값은 content를 직접 고치고,
        사람이 판단할 위반은 경고 문구로 돌려준다."""
        return []

    async def generate_slot(
        self, run: RunState, slot: str, feedback: str | None = None, on_option: OnOption | None = None
    ) -> SlotState:
        context = self.build_context(run, slot)
        angles = [self.angles[i % len(self.angles)] for i in range(settings.num_options)]
        jobs = [
            (
                option_label(angle, feedback),
                lambda i=i, angle=angle: self.generate_option(run, slot, context, with_feedback(angle, feedback), i),
            )
            for i, angle in enumerate(angles)
        ]
        return await self.collect_options(run, slot, jobs, on_option)

    async def collect_options(
        self,
        run: RunState,
        slot: str,
        jobs: list[tuple[str, Callable[[], Awaitable[BaseModel]]]],
        on_option: OnOption | None = None,
    ) -> SlotState:
        """(안 이름, 안 하나를 만드는 함수) 목록을 병렬로 돌려 끝나는 대로 on_option에 알린다.
        일부 안만 실패하면 성공한 안으로 보여주고, 모두 실패했을 때만 단계 실패."""
        done: list[Option] = []  # 끝난 순서대로. 화면에 먼저 나온 안의 순서가 끝까지 유지된다
        failures: list[str] = []

        async def one(index: int, label: str, make: Callable[[], Awaitable[BaseModel]]) -> None:
            try:
                content = await self.with_retry(make, f"{slot} 안 {index + 1}")
            except Exception as e:
                failures.append(f"안 {index + 1}: {failure_reason(e)}")
                logger.warning("%s/%s 안 %d 끝내 실패: %s", self.name, slot, index + 1, failures[-1])
                if on_option:
                    on_option(slot, None, failures[-1])
                raise
            option = self.make_option(run, slot, label, content)
            done.append(option)
            if on_option:
                on_option(slot, option, None)

        results = await asyncio.gather(*(one(i, label, make) for i, (label, make) in enumerate(jobs)), return_exceptions=True)
        if not done:
            raise next(r for r in results if isinstance(r, BaseException))
        return SlotState(options=done, failures=failures)

    async def with_retry(self, make: Callable[[], Awaitable[T]], what: str) -> T:
        """모델 응답이 가끔 스키마를 어기거나 일시 오류가 나므로, 실패하면 그 호출만 다시 시도한다."""
        for attempt in range(1, GENERATE_ATTEMPTS + 1):
            try:
                return await make()
            except Exception:
                if attempt == GENERATE_ATTEMPTS:
                    raise
                logger.warning("%s/%s 생성 실패, 다시 시도합니다", self.name, what, exc_info=True)
                await asyncio.sleep(RETRY_BACKOFF * attempt)  # 할당량 초과(429)는 잠깐 기다려야 풀린다
        raise AssertionError("unreachable")

    async def generate(
        self, run: RunState, slots: list[str], feedback: str | None = None, on_option: OnOption | None = None
    ) -> dict[str, SlotState]:
        states = await asyncio.gather(*(self.generate_slot(run, slot, feedback, on_option) for slot in slots))
        return dict(zip(slots, states))

    def make_option(self, run: RunState, slot: str, angle: str, content: BaseModel) -> Option:
        warnings = self.postprocess(run, slot, content)
        return Option(angle=angle, content=content.model_dump(), warnings=warnings)

    def make_edited_option(self, run: RunState, slot: str, angle: str, edited: dict[str, Any]) -> Option:
        """사람이 고친 내용도 같은 스키마·규칙으로 검사한다. 형식이 틀리면 ValidationError."""
        content = self.schema.model_validate(edited)
        self.check_output(run, slot, content)
        return self.make_option(run, slot, angle, content)


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
        content = await invoke_structured(self.prompt_name, self.schema, {**context, "angle": angle})
        self.check_output(run, slot, content)
        return content


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
