import re
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.core.domain import MAX_EXTRA_PRODUCT_IMAGES, MAX_PODS, Mood
from app.core.profile import FOLD_PROFILE, ProductProfile
from app.core.seed import FOLD_TEMPLATE

# 단계 순서. 각 단계는 바로 앞 단계에서 선택된 안을 입력으로 받는다.
STEP_ORDER = ("pod", "copy", "image")

# 안을 하나만 고르는 단계(POD, 카피)의 슬롯 이름. 이미지 단계는 Pod 이름을 슬롯으로 쓴다.
MAIN_SLOT = "main"


POD_KEY = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


class PodInput(BaseModel):
    """이번 실행에 쓰는 Pod 하나. 템플릿에서 불러오고 실행마다 고칠 수 있다."""

    name: str = Field(min_length=1, max_length=30, description="Pod 이름. eyebrow와 슬롯 이름으로 그대로 쓴다")
    key: str = Field(
        default="", max_length=30, description="영문 이름 (HTML 합성용 이미지 파일명). 비우면 순서대로 pod1, pod2 …"
    )
    spec: str = Field(default="", description="Pod별 스펙(Fact)")
    visual: str = Field(default="", description="이미지 기본 연출 방향")

    @model_validator(mode="after")
    def _clean(self) -> "PodInput":
        self.name = self.name.strip()
        self.key = self.key.strip().lower()
        if self.key and not POD_KEY.match(self.key):
            raise ValueError(f"Pod '{self.name}'의 영문 이름은 영문 소문자·숫자·_·- 만 쓸 수 있습니다: {self.key}")
        return self


class RunInput(BaseModel):
    template_id: int | None = Field(default=None, description="불러온 템플릿 (없으면 직접 입력)")
    target_id: str = Field(default="P1", description="타겟 구분 (P1/P2/P3)")
    persona: str = Field(min_length=1, description="타겟 페르소나 (관심사)")
    mood: Mood  # 소구 강도 (HOT / WARM / COLD)
    used_first_pod: str | None = Field(default=None, description="앞선 타겟에서 이미 쓴 1순위 Pod")
    product_name: str = Field(min_length=1, description="영문 공식 제품명")
    colors: str = Field(min_length=1, description="컬러 라인업 (쉼표로 구분)")
    pods: list[PodInput] = Field(min_length=1, max_length=MAX_PODS, description="이번에 쓰는 Pod (기본 순서대로)")
    # 공식 제품 사진을 바꾸거나 지운 자리만 적는다. 없는 자리 = 기본 사진, null = 지움, 문자열 = 올린 파일 이름
    product_images: dict[str, str | None] = Field(
        default={}, description="공식 제품 사진 자리별 선택 (없으면 기본 사진)"
    )
    extra_product_images: list[str] = Field(
        default=[], max_length=MAX_EXTRA_PRODUCT_IMAGES, description="5자리 외에 더 올린 제품 사진 파일 이름"
    )
    profile: ProductProfile | None = Field(
        default=None, description="제품 프로필(프롬프트의 제품별 블록). 템플릿에서 불러오거나 AI가 만든다. 없으면 Fold"
    )

    @model_validator(mode="before")
    @classmethod
    def _from_legacy_specs(cls, data: Any) -> Any:
        """Pod를 고를 수 있게 되기 전 실행은 입력에 specs({Pod 이름: 스펙})만 있다. Fold 기본 Pod로 채운다."""
        if isinstance(data, dict) and "pods" not in data and "specs" in data:
            specs = data["specs"]
            data = {
                **data,
                "pods": [{**pod, "spec": specs.get(pod["name"], "")} for pod in FOLD_TEMPLATE["pods"]],
            }
        return data

    @model_validator(mode="after")
    def _check_pods(self) -> "RunInput":
        names = [pod.name for pod in self.pods]
        if len(set(names)) < len(names):
            raise ValueError("Pod 이름이 겹칩니다.")
        for i, pod in enumerate(self.pods, 1):
            pod.key = pod.key or f"pod{i}"
        keys = [pod.key for pod in self.pods]
        if len(set(keys)) < len(keys):
            raise ValueError("Pod 영문 이름이 겹칩니다.")
        # 원본 P1: 제품 정보가 전혀 없으면 진행하지 않는다
        if not any(pod.spec.strip() for pod in self.pods):
            raise ValueError("Pod별 스펙을 하나 이상 입력해 주세요.")
        # 프로필에 없는 사진 자리는 버린다 (다른 제품 템플릿에서 넘어온 값)
        slots = set(self.product_profile.slot_labels())
        self.product_images = {k: v for k, v in self.product_images.items() if k in slots}
        if self.used_first_pod not in (None, *names):
            self.used_first_pod = None  # 앞선 타겟의 Pod가 이번 Pod 목록에 없으면 규칙이 의미 없다
        return self

    @property
    def product_profile(self) -> ProductProfile:
        """제품별 프롬프트 블록. 프로필 기능 전에 만든 실행은 Galaxy Z Fold 프로필을 쓴다."""
        return self.profile or FOLD_PROFILE

    @property
    def pod_names(self) -> list[str]:
        """기본 순서 (① Pod 순서 규칙의 기준)."""
        return [pod.name for pod in self.pods]

    def pod(self, name: str) -> PodInput:
        return next(pod for pod in self.pods if pod.name == name)

    @property
    def color_list(self) -> list[str]:
        return [c.strip() for c in self.colors.split(",") if c.strip()]

    def format(self) -> str:
        """모든 프롬프트에 공통으로 들어가는 [입력 데이터] 블록."""
        specs = "\n".join(f"  - {pod.name} : {pod.spec.strip() or '(입력 데이터 없음)'}" for pod in self.pods)
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
    pending: int = 0  # 아직 만드는 중인 안의 수. 이미지는 한 장씩 끝나는 대로 options에 붙는다
    # 이 안들을 만든 뒤 앞 단계에서 바뀐 점 (예: 이미지를 만든 뒤 그 Pod의 카피를 고침). 다시 생성하면 비워진다
    stale: list[str] = []

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
