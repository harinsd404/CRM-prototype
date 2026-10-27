from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.core.domain import POD_NAMES, Mood, PodName, ProductImageRole

# 단계 순서. 각 단계는 바로 앞 단계에서 선택된 안을 입력으로 받는다.
STEP_ORDER = ("pod", "copy", "image")

# 안을 하나만 고르는 단계(POD, 카피)의 슬롯 이름. 이미지 단계는 Pod 이름을 슬롯으로 쓴다.
MAIN_SLOT = "main"


class RunInput(BaseModel):
    target_id: str = Field(default="P1", description="타겟 구분 (P1/P2/P3)")
    persona: str = Field(min_length=1, description="타겟 페르소나 (관심사)")
    mood: Mood  # 소구 강도 (HOT / WARM / COLD)
    used_first_pod: PodName | None = Field(default=None, description="앞선 타겟에서 이미 쓴 1순위 Pod")
    product_name: str = Field(min_length=1, description="영문 공식 제품명")
    colors: str = Field(min_length=1, description="컬러 라인업 (쉼표로 구분)")
    specs: dict[PodName, str] = Field(description="Pod별 스펙(Fact)")
    # 공식 제품 사진을 바꾸거나 지운 자리만 적는다. 없는 자리 = 기본 사진, null = 지움, 문자열 = 올린 파일 이름
    product_images: dict[ProductImageRole, str | None] = Field(
        default={}, description="공식 제품 사진 자리별 선택 (없으면 기본 사진)"
    )

    @model_validator(mode="after")
    def _require_specs(self) -> "RunInput":
        # 원본 P1: 제품 정보가 전혀 없으면 진행하지 않는다
        if not any(self.specs.get(pod, "").strip() for pod in POD_NAMES):
            raise ValueError("Pod별 스펙을 하나 이상 입력해 주세요.")
        return self

    @property
    def color_list(self) -> list[str]:
        return [c.strip() for c in self.colors.split(",") if c.strip()]

    def format(self) -> str:
        """모든 프롬프트에 공통으로 들어가는 [입력 데이터] 블록."""
        specs = "\n".join(f"  - {pod} : {self.specs.get(pod, '').strip() or '(입력 데이터 없음)'}" for pod in POD_NAMES)
        return "\n".join(
            [
                f"- 타겟 페르소나 : {self.persona}",
                f"- 소구 강도(무드) : {self.mood}",
                f"- 이미 사용된 1순위 Pod : {self.used_first_pod or '없음'}",
                f"- 제품명 : {self.product_name}",
                f"- 컬러 라인업 : {self.colors}",
                "- Pod별 스펙(Fact) :",
                specs,
            ]
        )


class Option(BaseModel):
    angle: str = Field(description="이 안을 만들 때 준 방향")
    content: dict[str, Any]
    warnings: list[str] = Field(default=[], description="코드로 검사한 규칙 위반")


class SlotState(BaseModel):
    """N개 안 중 하나를 고르는 단위."""

    options: list[Option] = []
    selected: int | None = None
    edited: Option | None = None  # 사람이 선택한 안을 고친 경우

    @property
    def selected_option(self) -> Option | None:
        if self.selected is None:
            return None
        return self.edited or self.options[self.selected]


class StepState(BaseModel):
    slots: dict[str, SlotState] = {}

    @property
    def complete(self) -> bool:
        return bool(self.slots) and all(slot.selected is not None for slot in self.slots.values())


class RunState(BaseModel):
    id: str
    created_at: datetime
    updated_at: datetime
    input: RunInput
    steps: dict[str, StepState] = Field(default_factory=lambda: {name: StepState() for name in STEP_ORDER})
    html: str | None = None

    def selected(self, step_name: str, slot: str = MAIN_SLOT) -> dict[str, Any]:
        option = self.steps[step_name].slots[slot].selected_option
        assert option is not None, f"{step_name}/{slot} 단계가 선택되지 않았다"
        return option.content

    def is_complete(self, step_name: str) -> bool:
        state = self.steps[step_name]
        if step_name == "image" and state.complete:
            # 이미지는 Pod별로 차례로 생성하므로 일부 Pod만 있을 수 있다. 모든 Pod가 있어야 완료.
            return set(state.slots) >= {item["pod"] for item in self.selected("pod")["items"]}
        return state.complete

    def previous_step(self, step_name: str) -> str | None:
        index = STEP_ORDER.index(step_name)
        return STEP_ORDER[index - 1] if index > 0 else None

    def reset_after(self, step_name: str) -> None:
        """앞 단계가 바뀌면 뒤 단계의 전제가 깨지므로 뒤 단계와 최종 HTML을 비운다."""
        for name in STEP_ORDER[STEP_ORDER.index(step_name) + 1 :]:
            self.steps[name] = StepState()
        self.html = None
