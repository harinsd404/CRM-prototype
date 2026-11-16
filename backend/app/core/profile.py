"""제품 프로필 = 프롬프트의 '제품별 블록'의 규격.

공통 골격(prompts/*.md: 역할, 레이아웃, 출력 형식, 사진 품질·글자 없음 같은 안전 규칙)은 모든 제품이 같고,
제품마다 다른 부분(기기 묘사, 제품 상태, 기본 이미지 자리, 공식 표기)만 이 규격으로 템플릿에 저장한다.
새 제품은 AI가 제품 정보와 기본 이미지를 보고 이 규격대로 만든다 (steps/profile.py). 사람이 고칠 수도 있다.

이미지 모델에 가는 글(device_rules, rules, caption 등)은 영어, 화면·연출안 LLM에 가는 글(label, brief_hint)은 한국어.
"""

import re
from typing import Literal

from pydantic import BaseModel, Field, model_validator

KEY = re.compile(r"^[a-z][a-z0-9_]*$")
COLOR_TOKEN = "[제품 컬러]"  # 이미지 프롬프트에서 연출안의 제품 컬러로 바뀌는 자리


class PhotoSlot(BaseModel):
    """기본 이미지 자리 하나 (예: 접은 앞면). 이미지 모델에 사진과 함께 caption을 보낸다."""

    key: str = Field(description="영문 소문자 키. 예: closed_front")
    label: str = Field(description="화면에 보이는 한국어 이름. 예: 접은 앞면")
    caption: str = Field(
        description="이미지 모델에 사진 앞에 붙이는 영어 설명 [대괄호]. 무엇을 따라 그리고 무엇을 무시할지까지"
    )
    required: bool = Field(description="이 사진이 없으면 그 자리를 주 참조로 쓰는 상태의 이미지를 만들 수 없는지")


class ProductState(BaseModel):
    """이미지에 보이는 제품의 상태·면 하나 (예: 접은 앞면 / 펼친 상태 / 냉장고 문 열림)."""

    key: str = Field(description="영문 소문자 키. 예: closed_front")
    label: str = Field(description="한국어 이름. 예: 접은 앞면")
    brief_hint: str = Field(description="연출안 작성자에게 주는 한국어 설명: 이 상태에서 카메라에 무엇이 보이는지")
    rules: str = Field(description="이미지 모델용 영어 규칙 (마크다운). '# This view: ...'로 시작. 비율·크기·보이는 부분")
    shows_screen: bool = Field(description="이 상태에서 화면이 카메라에 보이는지 (화면이 없는 제품이면 false)")
    orientation: Literal["portrait", "landscape", "any"] = Field(
        description="이 상태에서 제품 방향이 정해져 있으면 portrait/landscape, 둘 다 가능하면 any"
    )
    photos: list[str] = Field(description="참조로 보낼 사진 자리 key. 첫 번째가 주 참조(반드시 있어야 하는 사진)")


class ProductProfile(BaseModel):
    device_noun: str = Field(description="영어 명사구. 예: book-style foldable phone")
    device_rules: str = Field(
        description=f"이미지 모델용 영어 '# Device' 규칙 (마크다운 목록). 모양·모서리·재질·버튼 등 늘 같은 것. "
        f"몸체 색은 '{COLOR_TOKEN}'로 적는다"
    )
    screen_rules: str = Field(default="", description="화면이 있는 제품이면 화면 표현 규칙(영어), 없으면 빈 문자열")
    check: str = Field(description="이미지 모델이 출력 전에 확인할 제품 관련 항목 (영어 한 줄, · 로 구분)")
    edit_rules: str = Field(description="이미지 수정 때 제품이 바뀌지 않게 지킬 영어 규칙 (마크다운 목록)")
    photo_slots: list[PhotoSlot]
    states: list[ProductState] = Field(min_length=1)
    reference_color: str = Field(
        default="", description="기본 이미지 속 제품 컬러 (한국어). 이 컬러가 아니면 color_slot 사진도 함께 보낸다"
    )
    color_slot: str | None = Field(default=None, description="컬러 라인업 사진 자리 key (없으면 null)")
    copy_terms: str = Field(
        default="", description="카피에서 번역·변형하지 않고 그대로 쓸 공식 표기 (한국어 문장, 쉼표로 나열)"
    )

    @model_validator(mode="after")
    def _check(self) -> "ProductProfile":
        """규격 검사: 키 형식·중복, 상태가 가리키는 사진 자리, 컬러 자리."""
        slot_keys = [s.key for s in self.photo_slots]
        state_keys = [s.key for s in self.states]
        for key in [*slot_keys, *state_keys]:
            if not KEY.match(key):
                raise ValueError(f"키는 영문 소문자로 시작하고 소문자·숫자·_만 씁니다: {key}")
        if reserved := [k for k in slot_keys if k.startswith("extra")]:
            raise ValueError(f"사진 자리 key는 extra로 시작할 수 없습니다 (추가 사진 파일 이름과 겹침): {', '.join(reserved)}")
        if len(set(slot_keys)) < len(slot_keys) or len(set(state_keys)) < len(state_keys):
            raise ValueError("사진 자리나 제품 상태의 key가 겹칩니다.")
        for state in self.states:
            if not state.photos:
                raise ValueError(f"상태 '{state.label}'에 참조 사진 자리가 없습니다.")
            if unknown := [p for p in state.photos if p not in slot_keys]:
                raise ValueError(f"상태 '{state.label}'가 없는 사진 자리를 가리킵니다: {', '.join(unknown)}")
        if self.color_slot is not None and self.color_slot not in slot_keys:
            self.color_slot = None
        if COLOR_TOKEN not in self.device_rules:
            self.device_rules = f"{self.device_rules.rstrip()}\n- Body color exactly {COLOR_TOKEN}."
        return self

    def state(self, key: str) -> ProductState:
        return next((s for s in self.states if s.key == key), self.states[0])

    def slot_labels(self) -> dict[str, str]:
        return {s.key: s.label for s in self.photo_slots}

    def required_slots(self) -> list[str]:
        """주 참조로 쓰이는 자리 (이 사진이 없으면 그 상태를 그릴 수 없다)."""
        mains = {state.photos[0] for state in self.states}
        return [s.key for s in self.photo_slots if s.required or s.key in mains]


_CREDIT_CARD = (
    "- Proportion of a credit card: upright, width = 0.63 × height; held sideways, height = 0.63 × width.\n"
    "  Shorter and wider than an ordinary smartphone — never a tall narrow bar.\n"
    "- Size: 77 mm wide, narrower than an adult palm (about 100 mm)."
)

# 지금까지 코드·프롬프트에 박혀 있던 Galaxy Z Fold 규칙. 수치(모서리 1/30, 비율 0.63·1.29)는 assets/product 공식 사진에서 잰 값
FOLD_PROFILE = ProductProfile(
    device_noun="book-style foldable phone",
    device_rules="""- Flat, squared aluminum frame; the long sides are straight all the way to the corners.
- Corners: all four outer corners share one tight radius of about 1/30 of the body height —
  nearly square, much tighter than an ordinary smartphone. Never soft or pill-shaped, never sharp 90°.
  Screen corners follow with a slightly smaller radius.
- Body color exactly [제품 컬러], matte. Light may rim the edges but never changes the body color.
- Fully closed or fully flat open only — never half folded. No stylus.""",
    screen_rules="""Show [화면 콘텐츠] as abstract UI: grey placeholder bars, colored blocks, image tiles.
No readable text, numbers, prices, or app/brand logos. Games and videos are generic original scenes.""",
    check="the side named above facing the camera · its own proportion · tight equal corners",
    edit_rules="""- The phone must stay exactly the device shown in the other attached official product images:
  same silhouette and proportion, same tight corner radius (about 1/30 of the body height),
  exactly 2 rear lenses plus one LED flash, same body color.
- Keep the same side (front screen or back) facing the camera as in the image to edit.""",
    photo_slots=[
        PhotoSlot(
            key="closed_front",
            label="접은 앞면",
            caption="[Product reference — CLOSED, FRONT side: cover screen with punch-hole camera.]",
            required=True,
        ),
        PhotoSlot(
            key="closed_back",
            label="접은 뒷면",
            caption="[Product reference — CLOSED, BACK side: matte back panel with the two-lens camera island.]",
            required=True,
        ),
        PhotoSlot(
            key="closed_views",
            label="접은 상태 측면·뒷면·앞면",
            caption="[Measurement sheet — this is ONE single device photographed three times (side, back, front) "
            "for thickness and frame shape only. These are NOT separate phones. "
            "Never reproduce this side-by-side layout.]",
            required=False,
        ),
        PhotoSlot(
            key="unfolded",
            label="펼친 상태",
            caption="[Product reference — FULLY UNFOLDED, inner main screen side. One flat device.]",
            required=True,
        ),
        PhotoSlot(
            key="color_lineup",
            label="컬러 라인업",
            caption="[Color swatch only — several units in different body colors. Take ONLY the requested body color. "
            "Ignore how many devices there are, their arrangement, and their angle.]",
            required=False,
        ),
    ],
    states=[
        ProductState(
            key="closed_front",
            label="접은 앞면",
            brief_hint="접은 상태, 커버 화면이 보임",
            rules=f"""# This view: CLOSED, FRONT
- We see the cover screen with a small punch-hole selfie camera at the top center.
  The back and the rear cameras are not visible.
{_CREDIT_CARD}
- Thin, even bezels on all four sides.""",
            shows_screen=True,
            orientation="any",
            photos=["closed_front", "closed_views"],
        ),
        ProductState(
            key="closed_back",
            label="접은 뒷면",
            brief_hint="접은 상태, 뒷면과 카메라 섬이 보이고 화면은 안 보임. 사진을 찍는 장면이면 보는 사람은 렌즈 앞(피사체 쪽)에 있음",
            rules=f"""# This view: CLOSED, BACK
- We see the matte back panel and the camera island. The screen faces away:
  no screen, viewfinder, or UI anywhere in the image.
- If someone is taking a photo with it, we stand in front of the lens, looking at the back.
{_CREDIT_CARD}
- Camera island: one vertical capsule with semicircular ends near the top-left corner (upright),
  the SAME matte color as the back, nearly flush — not a glossy black module.
  Inside it: exactly two equal circular lenses stacked vertically, and one small flash dot below them.
  The flash is not a lens. No logo on the back.""",
            shows_screen=False,
            orientation="any",
            photos=["closed_back", "closed_views"],
        ),
        ProductState(
            key="unfolded",
            label="펼친 상태",
            brief_hint="완전히 펼친 상태, 큰 안쪽 화면이 보임",
            rules="""# This view: FULLY UNFOLDED
- One flat slab showing the large inner screen. The back is not visible.
  Not two phones side by side, not a V shape, no visible crease.
- Wider than tall: width = 1.29 × height, close to a 4:3 photo — a small square-ish tablet, not a wide 16:9 tablet.
- Small punch-hole camera near the top right of the screen. Thin, even bezels.
- Size: 158 mm wide, about 1.5 adult palms; held with two hands.""",
            shows_screen=True,
            orientation="landscape",
            photos=["unfolded"],
        ),
    ],
    reference_color="라벤더",
    color_slot="color_lineup",
    copy_terms='"Now nudge", "ProVisual Engine", "스냅드래곤® 8 Elite 5세대", "나이토그래피", "플렉스 티타늄", "아머 플렉스힌지"',
)

# 예전 실행의 연출안 state 값(영어 문장) → 지금 상태 key
LEGACY_STATES = {
    "fully closed front": "closed_front",
    "fully closed back": "closed_back",
    "fully unfolded": "unfolded",
}
