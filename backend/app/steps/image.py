import random
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from app.config import settings
from app.core.domain import (
    LAYOUT_DESCRIPTIONS,
    LAYOUT_RATIOS,
    NO_SAFE_ZONE,
    POD_VISUAL_DEFAULTS,
    Ratio,
)
from app.core.prompts import PROMPT_DIR
from app.core.state import RunState
from app.core.store import EXTRA_PREFIX, product_image_dir, run_dir
from app.providers.image import get_image_provider
from app.steps.base import Step, invoke_structured

# 제품 상태별 공식 제품 사진 (assets/product/{이름}.png|jpg|webp). P2의 첨부 ①. 앞의 것이 주 참조
_PRODUCT_REFERENCES = {
    "fully closed front": ["closed_front", "closed_views"],
    "fully closed back": ["closed_back", "closed_views"],
    "fully unfolded": ["unfolded"],
}
# 제품 사진이 모두 이 컬러라서, 다른 컬러일 때만 컬러 라인업 사진을 함께 보낸다
_REFERENCE_COLOR = "라벤더"
_COLOR_LINEUP = "color_lineup"
_STYLE_ANCHOR = "style_anchor"  # P2의 첨부 ② (선택)
_REFERENCE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp")

# 제품 상태로 정해지는 시점. 모델이 state와 다른 view를 쓰면 앞·뒷면이 섞여 나와서 코드가 맞춘다
_STATE_VIEWS = {
    "fully closed front": "straight-on front",
    "fully closed back": "straight-on back",
    "fully unfolded": "straight-on unfolded",
}
SCREEN_HIDDEN = "보이지 않음 (뒷면이 카메라를 향함)"

# L3 Safe Zone 설명에 쓰면 이미지에 단색 띠가 생기는 단어 (원본 P1 Safe Zone Rules)
_SAFE_ZONE_BANNED = ("여백", "빈 공간", "패널", "띠", "프레임")


class ImageBrief(BaseModel):
    """원본 P1의 '이미지 Input Data' 블록."""

    concept: str = Field(description="이미지 콘셉트를 한국어 한 줄로")
    image_type: Literal["Base", "Hand-held", "인물 포함", "배경 연출"]
    color: str = Field(description="입력 컬러 라인업 중 1개")
    state: Literal["fully closed front", "fully closed back", "fully unfolded"]
    view: Literal["straight-on front", "straight-on back", "straight-on unfolded"]
    orientation: Literal["portrait", "landscape"] = Field(
        default="portrait",
        description="접은 기기를 세로로 두면 portrait, 가로로 쥐면 landscape. 펼친 상태는 항상 landscape",
    )
    scene: str = Field(description="장소, 시간대")
    props: str = Field(description="소품 2~3개")
    screen_content: str = Field(description=f"화면 콘텐츠. 글자 없는 추상적 UI 설명. 뒷면이면 '{SCREEN_HIDDEN}'")
    person_hand: str = Field(description="인물/손 묘사 또는 '없음'")
    face: Literal["hidden", "no person"]
    composition: str = Field(description="앵글, 제품 점유율 %")
    ratio: Ratio
    safe_zone: str = Field(description=f"L3만 장면 안의 조용한 영역으로 지정, 나머지는 '{NO_SAFE_ZONE}'")


class ImageOption(BaseModel):
    brief: ImageBrief
    prompt: str = Field(description="이미지 모델에 넣을 최종 프롬프트 (P2 + 이미지 Input Data)")
    image_url: str


def normalize_brief(brief: ImageBrief, layout: str) -> None:
    """레이아웃으로 정해지는 값은 모델에 맡기지 않고 코드로 맞춘다."""
    allowed = LAYOUT_RATIOS[layout]
    if brief.ratio not in allowed:
        brief.ratio = allowed[0]
    if layout != "L3":
        brief.safe_zone = NO_SAFE_ZONE
    # 앞·뒷면이 한 장면에 섞이지 않게: 시점은 상태에서, 뒷면이면 화면은 보이지 않는다
    brief.view = _STATE_VIEWS[brief.state]
    if brief.state == "fully unfolded":
        brief.orientation = "landscape"
    if brief.state == "fully closed back":
        brief.screen_content = SCREEN_HIDDEN
    if brief.image_type in ("Base", "배경 연출"):
        brief.person_hand, brief.face = "없음", "no person"


def check_brief(brief: ImageBrief, layout: str, colors: list[str]) -> list[str]:
    warnings = []
    if colors and brief.color not in colors:
        warnings.append(f"제품 컬러 '{brief.color}'가 입력 컬러 라인업에 없습니다.")
    if layout == "L3" and (words := [w for w in _SAFE_ZONE_BANNED if w in brief.safe_zone]):
        warnings.append(f"Safe Zone 설명에 금지어가 있습니다: {', '.join(words)}")
    if brief.face == "hidden" and brief.person_hand in ("", "없음"):
        warnings.append("얼굴이 hidden인데 인물/손 묘사가 없습니다.")
    if brief.image_type in ("Hand-held", "인물 포함") and brief.person_hand in ("", "없음"):
        warnings.append(f"이미지 유형이 {brief.image_type}인데 인물/손 묘사가 없습니다.")
    return warnings


def _find_reference(folder: Path, stem: str) -> Path | None:
    return next(
        (path for suffix in _REFERENCE_SUFFIXES if (path := folder / f"{stem}{suffix}").exists()),
        None,
    )


def reference_images(run: RunState, brief: ImageBrief) -> list[Path]:
    """제품 상태에 맞는 공식 제품 사진(①)과, 있으면 컬러 라인업·추가 제품 사진·스타일 앵커(②)를 P2의 첨부 순서대로.
    제품 사진은 입력 화면에서 고른 것(실행 폴더), 스타일 앵커는 assets/product의 것을 쓴다.
    주 참조 사진이 없으면 빈 목록이다 (나머지만 보내면 제품을 지어내므로)."""
    folder = product_image_dir(run.id)
    main, *extra = _PRODUCT_REFERENCES[brief.state]
    if (product := _find_reference(folder, main)) is None:
        return []
    stems = [*extra]
    if _REFERENCE_COLOR not in brief.color:
        stems.append(_COLOR_LINEUP)
    found = [_find_reference(folder, stem) for stem in stems]
    # 입력 화면에서 더 올린 제품 사진 (extra_1, extra_2 … 순서)
    found += sorted(
        (p for p in folder.glob(f"{EXTRA_PREFIX}*") if p.suffix.lower() in _REFERENCE_SUFFIXES),
        key=lambda p: int(p.stem.removeprefix(EXTRA_PREFIX)),
    )
    found.append(_find_reference(settings.product_image_dir, _STYLE_ANCHOR))
    return [product, *filter(None, found)]


# 제품 상태·방향별로 '카메라에 무엇이 보이는가'를 코드가 고정해서 적는다 (LLM 연출안의 모순을 덮어쓴다)
_SHOT_SIDES = {
    "fully closed front": (
        "The device is CLOSED. Its FRONT faces the camera: we see the cover screen "
        "with the small punch-hole selfie camera. The back panel and the rear camera island are NOT visible."
    ),
    "fully closed back": (
        "The device is CLOSED. Its BACK faces the camera: we see the matte back panel and the "
        "two-lens camera island. The screen faces AWAY from the camera and is NOT visible — "
        "no screen content, no viewfinder, no UI anywhere in the image. "
        "If a person is holding it to take a photo, the camera is in front of the lens, looking at the back."
    ),
    "fully unfolded": (
        "The device is FULLY UNFOLDED and perfectly flat. Its large inner main screen faces the camera. "
        "The back panel and the rear camera island are NOT visible. It is one single flat slab, "
        "not two phones side by side and not a book-like V shape."
    ),
}
_SHOT_SHAPES = {
    ("closed", "portrait"): (
        "Upright (portrait). The silhouette is taller than wide with the proportion of a credit card: "
        "width = 0.63 × height. Noticeably shorter and wider than an ordinary smartphone."
    ),
    ("closed", "landscape"): (
        "Turned sideways (landscape). The silhouette is wider than tall with the proportion of a credit card "
        "lying on its long side: height = 0.63 × width. Not a long thin bar."
    ),
    ("unfolded", "landscape"): (
        "Wider than tall, close to a 4:3 photo: width = 1.29 × height. "
        "It looks like a small square-ish tablet, not a wide 16:9 tablet."
    ),
}


def shot_lock(brief: ImageBrief) -> str:
    """이 이미지에서 기기가 몇 대이고 어느 면이 보이며 실루엣 비율이 얼마인지 — 모델이 가장 자주 틀리는 세 가지."""
    folded = "unfolded" if brief.state == "fully unfolded" else "closed"
    lines = [
        "- Exactly ONE device in the whole image. No second phone, no reflection or mirror copy of it.",
        f"- Side facing the camera: {_SHOT_SIDES[brief.state]}",
        f"- Silhouette: {_SHOT_SHAPES[(folded, brief.orientation)]}",
        "- Camera faces the device squarely, so its outline is a clean rounded rectangle "
        "(not a trapezoid). Uniform scale only — never stretch it to fit the canvas.",
    ]
    if brief.face == "hidden":
        lines.append("- No face: frame the person below the chin, or show only hands and arms.")
    return "\n".join(lines)


def build_image_prompt(run: RunState, pod: str, layout: str, brief: ImageBrief) -> str:
    """원본 P2(prompts/image_model.md) 뒤에 이 Pod의 이미지 Input Data를 붙인다."""
    template = (PROMPT_DIR / "image_model.md").read_text(encoding="utf-8")
    template = re.sub(r"<!--.*?-->\s*", "", template, flags=re.DOTALL)  # 메모 주석은 모델에 보내지 않는다
    data = "\n".join(
        [
            f"- Pod : {pod}",
            f"- 타겟 페르소나 : {run.input.persona}",
            f"- 레이아웃 : {layout} ({LAYOUT_DESCRIPTIONS[layout]})",
            f"- 이미지 유형 : {brief.image_type}",
            f"- 제품 컬러 : {brief.color}",
            f"- 제품 상태 : {brief.state}",
            f"- 시점 : {brief.view} ({brief.orientation})",
            f"- 장면 : {brief.scene}",
            f"- 소품 : {brief.props}",
            f"- 화면 콘텐츠 : {brief.screen_content}",
            f"- 인물/손 : {brief.person_hand}",
            f"- 얼굴 : {brief.face}",
            f"- 구도 : {brief.composition}",
            f"- 소구 강도(무드) : {run.input.mood}",
            f"- 화면비 : {brief.ratio}",
            f"- Text Safe Zone : {brief.safe_zone}",
        ]
    )
    return f"{template.rstrip()}\n\n{data}\n\n# Shot Lock (overrides any conflicting item above)\n\n{shot_lock(brief)}\n"


class ImageStep(Step):
    """Pod마다 슬롯 하나: LLM이 이미지 연출안(Input Data)을 쓰고 → 이미지 모델이 그린다."""

    name = "image"
    schema = ImageOption
    angles = [
        "제품 단독(Base) 또는 한 손에 쥔 클로즈업",
        "손이나 인물(얼굴 비노출)이 함께 있는 사용 장면",
        "공간·배경 연출이 돋보이는 장면",
    ]

    def _plan_item(self, run: RunState, pod: str) -> dict:
        return next(item for item in run.selected("pod")["items"] if item["pod"] == pod)

    def slots(self, run: RunState) -> list[str]:
        return [item["pod"] for item in run.selected("pod")["items"]]

    def build_context(self, run: RunState, slot: str) -> dict[str, str]:
        layout = self._plan_item(run, slot)["layout"]
        copy = next(p for p in run.selected("copy")["pods"] if p["pod"] == slot)
        if layout == "L3":
            safe_zone_rule = (
                "레이아웃이 L3이므로 텍스트가 이미지 위에 놓입니다. safe_zone에는 '빈 영역'이 아니라 "
                "'장면 안의 조용한 영역'을 위치와 함께 묘사하세요. 예: '하단 40% — 초점이 날아간 테이블 표면'. "
                f"'{', '.join(_SAFE_ZONE_BANNED)}'라는 단어는 쓰지 않습니다."
            )
        else:
            safe_zone_rule = f"레이아웃이 {layout}이므로 텍스트는 이미지 밖에 놓입니다. safe_zone은 '{NO_SAFE_ZONE}'로 씁니다."
        return {
            "input_data": run.input.format(),
            "pod": slot,
            "layout": f"{layout} ({LAYOUT_DESCRIPTIONS[layout]})",
            "allowed_ratios": " / ".join(LAYOUT_RATIOS[layout]),
            "visual_default": POD_VISUAL_DEFAULTS[slot],
            "safe_zone_rule": safe_zone_rule,
            "headline": copy["headline"],
            "body": copy["body"],
        }

    async def generate_option(
        self, run: RunState, slot: str, context: dict[str, str], angle: str, index: int
    ) -> ImageOption:
        layout = self._plan_item(run, slot)["layout"]
        if settings.llm_provider == "mock":
            brief = self._mock_brief(run, slot, layout, angle, index)
        else:
            brief = await invoke_structured("image_brief", ImageBrief, {**context, "angle": angle})
        normalize_brief(brief, layout)
        prompt = build_image_prompt(run, slot, layout, brief)

        out_dir = run_dir(run.id) / "images"
        out_dir.mkdir(parents=True, exist_ok=True)
        path = await get_image_provider().generate(
            prompt,
            reference_images(run, brief),
            out_dir,
            ratio=brief.ratio,
            label=f"{slot} · {brief.concept}",
            seed=random.randint(0, 2**31 - 1),
            pod=slot,
        )
        return ImageOption(brief=brief, prompt=prompt, image_url=f"/api/files/{run.id}/images/{path.name}")

    async def revise_option(self, run: RunState, slot: str, content: ImageOption, request: str) -> ImageOption:
        """이미 만든 이미지 한 장을 사람의 요청대로 고친 새 안을 만든다. 연출안(brief)은 그대로 둔다."""
        images = run_dir(run.id) / "images"
        source = images / Path(content.image_url).name
        path = await get_image_provider().edit(
            source,
            request,
            reference_images(run, content.brief),
            images,
            ratio=content.brief.ratio,
            seed=random.randint(0, 2**31 - 1),
            pod=slot,
        )
        return ImageOption(
            brief=content.brief,
            prompt=f"{content.prompt}\n# Revision Request\n{request}\n",
            image_url=f"/api/files/{run.id}/images/{path.name}",
        )

    def postprocess(self, run: RunState, slot: str, content: ImageOption) -> list[str]:
        layout = self._plan_item(run, slot)["layout"]
        normalize_brief(content.brief, layout)
        return check_brief(content.brief, layout, run.input.color_list)

    def _mock_brief(self, run: RunState, pod: str, layout: str, angle: str, index: int) -> ImageBrief:
        colors = run.input.color_list
        image_type = ("Base", "Hand-held", "배경 연출")[index % 3]
        return ImageBrief(
            concept=f"[예시] {angle}",
            image_type=image_type,
            color=colors[index % len(colors)] if colors else "",
            state="fully unfolded" if pod == "디스플레이" else "fully closed front",
            view="straight-on unfolded" if pod == "디스플레이" else "straight-on front",
            orientation="landscape" if pod == "디스플레이" else "portrait",
            scene="[예시] 오후의 밝은 카페 창가",
            props="커피잔, 노트",
            screen_content="회색 막대와 컬러 블록으로 된 추상 UI",
            person_hand="한 손이 뒤에서 기기를 받침" if image_type == "Hand-held" else "없음",
            face="hidden" if image_type == "Hand-held" else "no person",
            composition="정면, 제품 점유율 45%",
            ratio=LAYOUT_RATIOS[layout][0],
            safe_zone="하단 40% — 초점이 날아간 테이블 표면" if layout == "L3" else NO_SAFE_ZONE,
        )
