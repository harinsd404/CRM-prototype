from pydantic import BaseModel, Field

from app.core.domain import POD_NAMES, Layout, PodName
from app.core.state import RunState
from app.steps.base import TextStep


class PodPlanItem(BaseModel):
    pod: PodName
    layout: Layout
    reason: str = Field(description="이 순위에 둔 근거. 타겟 정의에 있는 표현만 사용")


class PodOption(BaseModel):
    target_summary: str = Field(description="타겟 요약 (한두 문장)")
    items: list[PodPlanItem] = Field(description="노출 순서대로 5개 Pod. 5개 모두 한 번씩")
    rationale: str = Field(description="이 순서와 레이아웃 조합을 고른 기획 의도")


def check_pod_plan(plan: PodOption, used_first_pod: str | None) -> list[str]:
    """원본 P1의 Order Rules / Layout Rules를 코드로 검사한다."""
    pods = [item.pod for item in plan.items]
    layouts = [item.layout for item in plan.items]
    warnings = []

    if sorted(pods) != sorted(POD_NAMES):
        warnings.append(f"5개 Pod가 한 번씩 들어 있지 않습니다: {', '.join(pods)}")
    if used_first_pod and pods and pods[0] == used_first_pod:
        warnings.append(f"1순위가 이미 사용된 1순위 Pod({used_first_pod})와 같습니다.")
    moved = sum(1 for i, pod in enumerate(pods) if i >= len(POD_NAMES) or POD_NAMES[i] != pod)
    if moved < 3:
        warnings.append(f"기본 순서 대비 위치가 바뀐 Pod가 {moved}개입니다 (최소 3개).")
    if any(a == b for a, b in zip(layouts, layouts[1:])):
        warnings.append("인접한 Pod에 같은 레이아웃이 연속으로 쓰였습니다.")
    if len(set(layouts)) < 4:
        warnings.append(f"레이아웃을 {len(set(layouts))}종만 썼습니다 (최소 4종).")
    return warnings


_MOCK_ORDERS: list[list[tuple[PodName, Layout]]] = [
    [("카메라", "L3"), ("디스플레이", "L5"), ("디자인", "L1"), ("성능", "L4"), ("Now nudge", "L2")],
    [("디스플레이", "L2"), ("Now nudge", "L4"), ("카메라", "L5"), ("디자인", "L3"), ("성능", "L1")],
    [("성능", "L5"), ("카메라", "L1"), ("Now nudge", "L3"), ("디스플레이", "L4"), ("디자인", "L2")],
]


class PodStep(TextStep):
    name = "pod"
    schema = PodOption
    prompt_name = "pod"
    angles = [
        "타겟의 관심사에 가장 직결되는 Pod를 1순위로 두는 구성",
        "소구 강도(HOT / WARM / COLD)에 맞는 감성을 앞세우는 구성",
        "구매 결정까지의 흐름(관심 → 확신 → 행동)을 따르는 구성",
    ]

    def build_context(self, run: RunState, slot: str) -> dict[str, str]:
        return {"input_data": run.input.format()}

    def postprocess(self, run: RunState, slot: str, content: PodOption) -> list[str]:
        return check_pod_plan(content, run.input.used_first_pod)

    def mock_option(self, run: RunState, slot: str, angle: str, index: int) -> PodOption:
        order = _MOCK_ORDERS[index % len(_MOCK_ORDERS)]
        return PodOption(
            target_summary=f"[예시] {run.input.persona}",
            items=[PodPlanItem(pod=pod, layout=layout, reason=f"[예시] {angle}") for pod, layout in order],
            rationale=f"[예시] '{angle}' 방향으로 순서를 잡았습니다.",
        )
