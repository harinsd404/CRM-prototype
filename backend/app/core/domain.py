"""삼성닷컴 Pod 도메인 상수. 원본 프롬프트(prompts/original/)의 규칙을 코드로 옮긴 것."""

from typing import Literal

PodName = Literal["디자인", "디스플레이", "성능", "카메라", "Now nudge"]
Layout = Literal["L1", "L2", "L3", "L4", "L5"]
Mood = Literal["HOT", "WARM", "COLD"]
Ratio = Literal["1:1", "4:3", "16:9"]

# 삼성닷컴 기본 순서
POD_NAMES: tuple[PodName, ...] = ("디자인", "디스플레이", "성능", "카메라", "Now nudge")

# HTML 합성용 이미지 파일명에 쓰는 영문 이름 (P1 [8] JSON의 img 규칙)
POD_ENGLISH: dict[str, str] = {
    "디자인": "design",
    "디스플레이": "display",
    "성능": "performance",
    "카메라": "camera",
    "Now nudge": "nudge",
}

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

# Pod별 기본 연출 방향 (입력 데이터와 충돌 시 입력 우선)
POD_VISUAL_DEFAULTS: dict[str, str] = {
    "디자인": "제품 단독 또는 한 손에 쥔 클로즈업",
    "디스플레이": "펼친 화면으로 콘텐츠 감상",
    "성능": "작업 또는 이동 중 장면",
    "카메라": "접은 상태를 가로로 쥐고 촬영하는 장면",
    "Now nudge": "일상 상황 속 인물(얼굴 비노출)",
}

NO_SAFE_ZONE = "없음 (텍스트는 이미지 외부 배치)"
