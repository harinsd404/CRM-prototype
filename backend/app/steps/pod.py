from pydantic import BaseModel, Field

from app.core.domain import LAYOUT_DESCRIPTIONS, Layout, pod_rules
from app.core.state import RunState
from app.steps.base import TextStep


class PodPlanItem(BaseModel):
    pod: str = Field(description="[입력 데이터]의 Pod 이름 그대로")
    layout: Layout
    reason: str = Field(description="이 순위에 둔 근거. 타겟 정의에 있는 표현만 사용")


class PodOption(BaseModel):
    target_summary: str = Field(description="타겟 요약 (한두 문장)")
    items: list[PodPlanItem] = Field(description="노출 순서대로 모든 Pod. 한 번씩")
    rationale: str = Field(description="이 순서와 레이아웃 조합을 고른 기획 의도")


def check_pod_plan(plan: PodOption, base_order: list[str], used_first_pod: str | None) -> list[str]:
    """원본 P1의 Order Rules / Layout Rules를 코드로 검사한다. 최소 개수는 Pod 수에 비례한다 (pod_rules)."""
    rules = pod_rules(len(base_order))
    pods = [item.pod for item in plan.items]
    layouts = [item.layout for item in plan.items]
    warnings = []

    if sorted(pods) != sorted(base_order):
        warnings.append(f"{len(base_order)}개 Pod가 한 번씩 들어 있지 않습니다: {', '.join(pods)}")
    if used_first_pod and len(base_order) > 1 and pods and pods[0] == used_first_pod:
        warnings.append(f"1순위가 이미 사용된 1순위 Pod({used_first_pod})와 같습니다.")
    moved = sum(1 for i, pod in enumerate(pods) if i >= len(base_order) or base_order[i] != pod)
    if moved < rules.min_moved:
        warnings.append(f"기본 순서 대비 위치가 바뀐 Pod가 {moved}개입니다 (최소 {rules.min_moved}개).")
    if any(a == b for a, b in zip(layouts, layouts[1:])):
        warnings.append("인접한 Pod에 같은 레이아웃이 연속으로 쓰였습니다.")
    if len(set(layouts)) < rules.min_layouts:
        warnings.append(f"레이아웃을 {len(set(layouts))}종만 썼습니다 (최소 {rules.min_layouts}종).")
    return warnings


def unknown_pods(names: list[str], allowed: list[str]) -> list[str]:
    return [name for name in names if name not in allowed]


_LAYOUT_NAMES: list[Layout] = list(LAYOUT_DESCRIPTIONS)  # type: ignore[arg-type]


def _mock_order(pods: list[str], index: int) -> list[tuple[str, Layout]]:
    """mock 모드 예시 순서: 안마다 다르게 돌리고 뒤집되, 레이아웃은 연속하지 않게 순환한다."""
    shift = (index + 1) % len(pods) if len(pods) > 1 else 0
    order = pods[shift:] + pods[:shift]
    if index % 2:
        order = order[::-1]
    return [(pod, _LAYOUT_NAMES[(i + index) % len(_LAYOUT_NAMES)]) for i, pod in enumerate(order)]


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
        names = run.input.pod_names
        rules = pod_rules(len(names))
        move_rule = (
            f"기본 순서를 그대로 쓰지 않습니다. 최소 {rules.min_moved}개 Pod의 위치가 기본 순서와 달라야 합니다."
            if rules.min_moved
            else "Pod가 1개이므로 순서는 그대로 둡니다."
        )
        return {
            "input_data": run.input.format(),
            "pod_count": str(len(names)),
            "pod_list": ", ".join(names),
            "base_order": " → ".join(names),
            "move_rule": move_rule,
            "min_layouts": str(rules.min_layouts),
        }

    def check_output(self, run: RunState, slot: str, content: PodOption) -> None:
        if unknown := unknown_pods([item.pod for item in content.items], run.input.pod_names):
            raise ValueError(f"입력에 없는 Pod 이름: {', '.join(unknown)}")

    def postprocess(self, run: RunState, slot: str, content: PodOption) -> list[str]:
        return check_pod_plan(content, run.input.pod_names, run.input.used_first_pod)

    def mock_option(self, run: RunState, slot: str, angle: str, index: int) -> PodOption:
        order = _mock_order(run.input.pod_names, index)
        return PodOption(
            target_summary=f"[예시] {run.input.persona}",
            items=[PodPlanItem(pod=pod, layout=layout, reason=f"[예시] {angle}") for pod, layout in order],
            rationale=f"[예시] '{angle}' 방향으로 순서를 잡았습니다.",
        )
