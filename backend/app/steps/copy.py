from collections import Counter
from typing import Literal

from pydantic import BaseModel, Field

from app.core.domain import LAYOUT_DESCRIPTIONS, PodName
from app.core.state import RunState
from app.steps.base import TextStep

HEADLINE_MAX = 20
BODY_MAX = 110


class FactCheck(BaseModel):
    expression: str = Field(description="카피 내 표현")
    source: str = Field(description="입력 데이터 원문 구절")


class PodCopy(BaseModel):
    pod: PodName
    eyebrow: str = Field(description="Pod명 그대로")
    headline: str = Field(description=f"헤드카피. 공백 포함 {HEADLINE_MAX}자 이내, 1줄")
    headline_type: Literal["a", "b", "c", "d", "e"] = Field(description="헤드카피 구조 유형")
    body: str = Field(description=f"바디카피. 2~3문장, 공백 포함 합계 {BODY_MAX}자 이내")
    ending_order: str = Field(description="바디카피 어미 배열. 예: 죠→보세요→습니다")
    factcheck: list[FactCheck]


class CopyOption(BaseModel):
    pods: list[PodCopy] = Field(description="확정된 Pod 순서와 같은 순서로 5개")
    rationale: str = Field(description="카피 소구 기획 의도")


def check_copy(copy: CopyOption, plan_pods: list[str]) -> list[str]:
    """원본 P1의 Writing Rules와 [7] 자가 점검을 코드로 검사한다."""
    warnings = []
    pods = [p.pod for p in copy.pods]
    if pods != plan_pods:
        warnings.append(f"Pod 순서가 ①에서 고른 순서와 다릅니다: {', '.join(pods)}")

    for p in copy.pods:
        p.eyebrow = p.pod  # eyebrow는 Pod명 그대로 (확정 규칙이라 코드로 고친다)
        if len(p.headline) > HEADLINE_MAX:
            warnings.append(f"[{p.pod}] 헤드카피 {len(p.headline)}자 (최대 {HEADLINE_MAX}자)")
        if len(p.body) > BODY_MAX:
            warnings.append(f"[{p.pod}] 바디카피 {len(p.body)}자 (최대 {BODY_MAX}자)")

    types = Counter(p.headline_type for p in copy.pods)
    if len(types) < 4:
        warnings.append(f"헤드카피 구조 유형을 {len(types)}종만 썼습니다 (최소 4종).")
    if overused := [t for t, n in types.items() if n > 2]:
        warnings.append(f"같은 헤드카피 유형을 2회 넘게 썼습니다: {', '.join(overused)}")
    endings = [p.ending_order.replace(" ", "") for p in copy.pods]
    if len(set(endings)) < len(endings):
        warnings.append("어미 배열이 같은 Pod가 있습니다.")
    return warnings


_MOCK_ENDINGS = ["습니다→죠→보세요", "죠→보세요→습니다", "보세요→습니다→죠", "습니다→보세요→죠", "죠→습니다→보세요"]
_MOCK_TYPES: list[Literal["a", "b", "c", "d", "e"]] = ["a", "b", "c", "d", "e"]


class CopyStep(TextStep):
    name = "copy"
    schema = CopyOption
    prompt_name = "copy"
    angles = [
        "기능명과 수치를 앞세우는 직설적인 카피",
        "타겟의 사용 장면을 그리는 카피",
        "고객 효익을 짧고 선명하게 정리하는 카피",
    ]

    def _plan(self, run: RunState) -> list[dict]:
        return run.selected("pod")["items"]

    def build_context(self, run: RunState, slot: str) -> dict[str, str]:
        plan = "\n".join(
            f"{rank}. {item['pod']} — {item['layout']} ({LAYOUT_DESCRIPTIONS[item['layout']]})"
            for rank, item in enumerate(self._plan(run), 1)
        )
        return {"input_data": run.input.format(), "pod_plan": plan}

    def postprocess(self, run: RunState, slot: str, content: CopyOption) -> list[str]:
        return check_copy(content, [item["pod"] for item in self._plan(run)])

    def mock_option(self, run: RunState, slot: str, angle: str, index: int) -> CopyOption:
        pods = []
        for i, item in enumerate(self._plan(run)):
            spec = run.input.specs.get(item["pod"], "").strip() or "(입력 데이터 없음)"
            pods.append(
                PodCopy(
                    pod=item["pod"],
                    eyebrow=item["pod"],
                    headline=f"[예시{index + 1}] {item['pod']} 헤드카피",
                    headline_type=_MOCK_TYPES[(i + index) % 5],
                    body=f"{spec[:40]}. 실제 생성에서는 이 자리에 바디카피가 들어갑니다.",
                    ending_order=_MOCK_ENDINGS[(i + index) % 5],
                    factcheck=[FactCheck(expression=spec[:20], source=spec[:20])],
                )
            )
        return CopyOption(pods=pods, rationale=f"[예시] '{angle}' 방향의 카피입니다.")
