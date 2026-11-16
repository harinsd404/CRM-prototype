"""삼성닷컴 Pod 도메인 상수. 원본 프롬프트(prompts/original/)의 규칙을 코드로 옮긴 것."""

from dataclasses import dataclass
from typing import Literal

# Pod는 템플릿마다 다르다 (예: Fold는 디자인·디스플레이·성능·카메라·Now nudge). 이름 그대로 슬롯 이름으로 쓴다. 한 실행의 최대 Pod 수
MAX_PODS = 10
Layout = Literal["L1", "L2", "L3", "L4", "L5"]
Mood = Literal["HOT", "WARM", "COLD"]
Ratio = Literal["1:1", "4:3", "16:9"]
# 공식 제품 사진(P2의 첨부 ①) 자리. 파일 이름(assets/product/{자리}.png)과 같다
ProductImageRole = Literal["closed_front", "closed_back", "closed_views", "unfolded", "color_lineup"]
PRODUCT_IMAGE_LABELS: dict[str, str] = {
    "closed_front": "접은 앞면",
    "closed_back": "접은 뒷면",
    "closed_views": "접은 상태 측면·뒷면·앞면",
    "unfolded": "펼친 상태",
    "color_lineup": "컬러 라인업",
}
# 5자리 외에 더 올릴 수 있는 제품 사진 수. 모두 첨부 ①의 보조 참조로 보낸다
MAX_EXTRA_PRODUCT_IMAGES = 5

LAYOUT_DESCRIPTIONS: dict[str, str] = {
    "L1": "텍스트 중앙 정렬(상) + 풀폭 이미지(하) — 텍스트는 이미지 밖",
    "L2": "풀폭 이미지(상) + 좌측 정렬 텍스트(하) — 텍스트는 이미지 밖",
    "L3": "풀블리드 이미지 + 하단 텍스트 오버레이 — 텍스트가 이미지 위",
    "L4": "카드형: 둥근 이미지 카드 + 하단 텍스트 영역 — 텍스트는 이미지 밖",
    "L5": "2단 분할: 좌측 텍스트 / 우측 이미지 — 텍스트는 이미지 밖",
}

# 화면비 규칙: 레이아웃별로 허용되는 비율 (첫 번째가 기본값)
LAYOUT_RATIOS: dict[str, tuple[Ratio, ...]] = {
    "L1": ("16:9", "4:3"),
    "L2": ("16:9", "4:3"),
    "L3": ("16:9",),
    "L4": ("4:3", "1:1"),
    "L5": ("4:3", "1:1"),
}

NO_SAFE_ZONE = "없음 (텍스트는 이미지 외부 배치)"


@dataclass(frozen=True)
class PodRules:
    """Pod 수(n)에 비례하는 규칙. 원본은 Pod 5개 기준(이동 3개, 레이아웃 4종, 헤드카피 유형 4종, 같은 유형 2회까지)."""

    count: int
    min_moved: int  # 기본 순서와 위치가 달라야 하는 Pod 수 = ⌈0.6n⌉ (1개면 0)
    min_layouts: int  # 써야 하는 레이아웃 종류 = min(5, ⌈0.8n⌉)
    min_headline_types: int  # 써야 하는 헤드카피 구조 유형 수 = min(5, ⌈0.8n⌉)
    max_same_headline_type: int  # 한 유형을 쓸 수 있는 최대 횟수 = max(2, ⌈n/5⌉)


def pod_rules(n: int) -> PodRules:
    ceil_08 = (4 * n + 4) // 5
    return PodRules(
        count=n,
        min_moved=(3 * n + 4) // 5 if n >= 2 else 0,
        min_layouts=min(5, ceil_08),
        min_headline_types=min(5, ceil_08),
        max_same_headline_type=max(2, (n + 4) // 5),
    )
