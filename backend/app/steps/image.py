import asyncio
import base64
import io
import logging
import random
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from langchain_core.messages import HumanMessage
from PIL import Image
from pydantic import BaseModel, Field, model_validator

from app.config import settings
from app.core.domain import (
    LAYOUT_DESCRIPTIONS,
    LAYOUT_RATIOS,
    NO_SAFE_ZONE,
    Ratio,
)
from app.core.profile import LEGACY_STATES, ProductProfile
from app.core.prompts import PROMPT_DIR
from app.core.state import RunState, SlotState, strip_hex
from app.core.store import EXTRA_PREFIX, product_image_dir, run_dir
from app.providers.image import Reference, get_image_provider
from app.llm import get_chat_model
from app.steps.base import OnOption, Step, invoke_structured, option_label, with_feedback

logger = logging.getLogger(__name__)

_STYLE_ANCHOR = "style_anchor"  # P2의 첨부 ② (선택, assets/product)
_REFERENCE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp")
_STYLE_CAPTION = "[Style anchor — copy only color grading, lighting and background tone. Ignore its content.]"
_EXTRA_CAPTION = (
    "[Additional detail photo of the same device — use only for design details. "
    "Ignore how many devices it shows and which side faces the camera.]"
)
SCREEN_HIDDEN = "보이지 않음 (화면이 카메라를 향하지 않음)"

# 프로필에 사용 방식(usage·person_rules)이 없을 때 (이 항목 전에 만든 템플릿). 제품 크기로 갈라 쓴다
_DEFAULT_USAGE = "제품 크기에 맞게: 작은 기기는 손에 쥐거나 착용하고, 큰 가전은 손잡이·문·조작부를 만지거나 옆에서 씀"
_DEFAULT_PERSON_RULES = (
    "- Interact with it the way its size allows: small devices are held in the hand or worn on the wrist;\n"
    "  large appliances stay in place while a hand touches a handle, door or control panel."
)

_PERSON_TYPES = ("Hand-held", "인물 포함")

# 무드별 장면의 빛·시간대. 이미지 모델의 mood 블록(image_model.md)과 같은 방향으로 연출안 단계에서 맞춘다.
# 실측: HOT인데 연출안이 "맑고 화창한 낮", "늦은 오후 햇살"을 써서 5장 중 4장이 따뜻한 햇살 사진(WARM)이 됐다
MOOD_GUIDES = {
    "HOT": "저녁·밤, 또는 빛을 줄인 실내. 배경에 네온 보라·전기 파랑 포인트 조명, 깊은 그림자와 강한 대비. "
    "한낮 햇살·노을 같은 따뜻한 자연광 장면은 쓰지 않습니다.",
    "WARM": "낮의 부드러운 자연광(창가 햇살, 오후 빛). 크림·파스텔 톤 공간, 은은한 그림자. 네온·어두운 장면은 쓰지 않습니다.",
    "COLD": "흐린 날이나 확산광의 밝고 고른 빛. 흰색·회색·차콜의 정돈된 공간, 그림자 거의 없음. 따뜻한 햇살·네온은 쓰지 않습니다.",
}
# 무드와 맞지 않는 빛을 쓴 연출안을 찾는 말 (경고용)
_MOOD_CLASH = {
    "HOT": re.compile(r"한낮|대낮|화창|햇살|햇빛|태양광|노을|해질녘|오전|아침 햇"),
    "WARM": re.compile(r"네온|한밤|자정|어두운"),
    "COLD": re.compile(r"네온|노을|해질녘|황금빛|따뜻한 햇"),
}

# L3 Safe Zone 설명에 쓰면 이미지에 단색 띠가 생기는 단어 (원본 P1 Safe Zone Rules)
_SAFE_ZONE_BANNED = ("여백", "빈 공간", "패널", "띠", "프레임")


class ImageBrief(BaseModel):
    """원본 P1의 '이미지 Input Data' 블록."""

    concept: str = Field(description="이미지 콘셉트를 한국어 한 줄로")
    image_type: Literal["Base", "Hand-held", "인물 포함", "배경 연출"]
    color: str = Field(description="입력 컬러 라인업 중 1개")
    state: str = Field(description="[제품 상태] 중 하나의 key 그대로")
    orientation: Literal["portrait", "landscape"] = Field(
        default="portrait",
        description="제품을 세로로 두면 portrait, 가로로 두면 landscape. 상태에 방향이 정해져 있으면 그 방향",
    )
    scene: str = Field(description="타겟 페르소나의 일상 속 장소, 시간대")
    props: str = Field(description="소품 2~3개")
    screen_content: str = Field(description=f"화면 콘텐츠. 글자 없는 추상적 UI 설명. 뒷면이면 '{SCREEN_HIDDEN}'")
    person_hand: str = Field(description="인물/손 묘사 또는 '없음'")
    face: Literal["visible", "hidden", "no person"] = Field(
        description="인물 얼굴이 보이면 visible, 손·팔이나 뒷모습만이면 hidden, 사람이 없으면 no person"
    )
    composition: str = Field(description="앵글, 촬영 거리, 화면 속 기기 위치, 제품 점유율 %")
    ratio: Ratio
    safe_zone: str = Field(description=f"L3만 장면 안의 조용한 영역으로 지정, 나머지는 '{NO_SAFE_ZONE}'")

    @model_validator(mode="before")
    @classmethod
    def _legacy_state(cls, data: Any) -> Any:
        """프로필 기능 전 연출안은 state가 'fully closed front' 같은 문장이고 view 칸이 있다."""
        if isinstance(data, dict) and data.get("state") in LEGACY_STATES:
            data = {**data, "state": LEGACY_STATES[data["state"]]}
        return data


class ImageBriefs(BaseModel):
    """한 Pod의 N안 연출안. 한 번에 써야 안끼리 장소·거리·위치가 겹치지 않는다."""

    briefs: list[ImageBrief] = Field(description="안별 연출 방향 순서대로, 요청한 개수만큼")


class ImageOption(BaseModel):
    brief: ImageBrief
    prompt: str = Field(description="이미지 모델에 넣을 최종 프롬프트 (P2 + 이미지 Input Data)")
    image_url: str
    # 예전 실행(얼굴 비노출 정책 때)의 얼굴 판정 결과. 지금은 얼굴을 허용해 판정하지 않는다 (읽기 호환용)
    face_visible: bool | None = None
    # 완성 이미지 속 제품이 그 상태의 공식 사진과 다른 모델로 보이면 무엇이 다른지 (AI 판정, 같거나 판정 못 하면 None)
    product_mismatch: str | None = None


class ProductCheck(BaseModel):
    same_product: bool = Field(description="광고 사진 속 제품이 공식 사진과 같은 모델이면 true")
    reason: str = Field(description="다르면 무엇이 다른지 한국어 한 줄 (예: 하단에 서랍 2칸이 있는 4도어), 같으면 빈 문자열")


_CHECK_SIDE = 768  # 판정용으로 줄여 보내는 크기


def _image_block(path: Path) -> dict:
    with Image.open(path) as image:
        image = image.convert("RGB")
        image.thumbnail((_CHECK_SIDE, _CHECK_SIDE))
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", quality=85)
    data = base64.b64encode(buffer.getvalue()).decode()
    return {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{data}"}}


async def check_product(path: Path, reference: Path, device_noun: str) -> str | None:
    """완성 이미지 속 제품이 공식 사진과 같은 모델인지 텍스트 모델(이미지 입력)에게 묻는다. 다르면 이유, 아니면 None.
    QA(냉장고): 참조 사진을 보냈는데도 13장 중 3장이 하단 서랍 4도어·하냉동 같은 다른 냉장고였고, 작은 카드에서는
    사람이 알아보기 어려워 그대로 골랐다. 경고용이라 판정에 실패하면 None (생성은 막지 않는다)."""
    if settings.llm_provider == "mock":
        return None
    try:
        message = HumanMessage(
            content=[
                {
                    "type": "text",
                    "text": f"[사진 1]은 광고 사진, [사진 2]는 이 {device_noun}의 공식 제품 사진입니다. "
                    "사진 1 속 제품이 사진 2와 같은 모델인지 판정하세요. 색·조명·배경·촬영 각도·문이나 덮개가 열린 정도·"
                    "화면 내용 차이는 무시하고, 전체 형태와 비율, 문·버튼·카메라·손잡이 같은 특징 부위의 개수와 배치만 봅니다. "
                    "제품이 일부만 보여 판단할 수 없으면 같은 것으로 봅니다.",
                },
                {"type": "text", "text": "[사진 1]"},
                _image_block(path),
                {"type": "text", "text": "[사진 2]"},
                _image_block(reference),
            ]
        )
        model = get_chat_model().with_structured_output(ProductCheck, method="json_schema")
        result = await asyncio.wait_for(model.ainvoke([message]), settings.llm_timeout)
        return None if result.same_product else (result.reason.strip() or "형태가 다름")
    except Exception:
        logger.warning("제품 모양 판정 실패: %s", path.name, exc_info=True)
        return None


def normalize_brief(brief: ImageBrief, layout: str, profile: ProductProfile) -> None:
    """레이아웃·제품 상태로 정해지는 값은 모델에 맡기지 않고 코드로 맞춘다."""
    allowed = LAYOUT_RATIOS[layout]
    if brief.ratio not in allowed:
        brief.ratio = allowed[0]
    if layout != "L3":
        brief.safe_zone = NO_SAFE_ZONE
    # 앞·뒷면이 한 장면에 섞이지 않게: 상태가 방향·화면 노출을 정한다
    state = profile.state(brief.state)
    brief.state = state.key
    if state.orientation != "any":
        brief.orientation = state.orientation
    if not state.shows_screen:
        brief.screen_content = SCREEN_HIDDEN
    if brief.image_type in ("Base", "배경 연출"):
        brief.person_hand, brief.face = "없음", "no person"
    brief.color = strip_hex(brief.color)  # 헥스는 코드가 입력에서 찾아 붙인다


def check_brief(brief: ImageBrief, layout: str, colors: list[str], mood: str | None = None) -> list[str]:
    warnings = []
    if mood in _MOOD_CLASH and (clash := _MOOD_CLASH[mood].findall(brief.scene)):
        warnings.append(f"무드 {mood}와 맞지 않는 빛의 장면입니다: {', '.join(dict.fromkeys(clash))}")
    if colors and brief.color not in colors:
        warnings.append(f"제품 컬러 '{brief.color}'가 입력 컬러 라인업에 없습니다.")
    if layout == "L3" and (words := [w for w in _SAFE_ZONE_BANNED if w in brief.safe_zone]):
        warnings.append(f"Safe Zone 설명에 금지어가 있습니다: {', '.join(words)}")
    if brief.face != "no person" and brief.person_hand in ("", "없음"):
        warnings.append(f"face가 {brief.face}인데 인물/손 묘사가 없습니다.")
    if brief.image_type in _PERSON_TYPES and brief.person_hand in ("", "없음"):
        warnings.append(f"이미지 유형이 {brief.image_type}인데 인물/손 묘사가 없습니다.")
    return warnings


def _find_reference(folder: Path, stem: str) -> Path | None:
    return next(
        (path for suffix in _REFERENCE_SUFFIXES if (path := folder / f"{stem}{suffix}").exists()),
        None,
    )


def reference_images(run: RunState, brief: ImageBrief) -> list[Reference]:
    """제품 상태의 참조 사진(첫 번째가 주 참조)과, 있으면 컬러 라인업·추가 제품 사진·스타일 앵커를 P2의 첨부 순서대로.
    사진마다 제품 프로필의 설명(caption)을 붙인다. 제품 사진은 입력 화면에서 고른 것(실행 폴더)을 쓴다.
    주 참조 사진이 없으면 빈 목록이다 (나머지만 보내면 제품을 지어내므로)."""
    profile = run.input.product_profile
    captions = {slot.key: slot.caption for slot in profile.photo_slots}
    folder = product_image_dir(run.id)
    main, *extra = profile.state(brief.state).photos
    if (product := _find_reference(folder, main)) is None:
        return []
    stems = [*extra]
    if profile.reference_color not in brief.color:
        # 컬러별 사진 자리(라벨에 컬러 이름, 예: '핑크 골드 컬러 라인업')가 있으면 그 사진을, 없으면 컬러 라인업 자리를 보낸다.
        # 실측: 버즈4 프로는 블랙·핑크 골드 사진이 따로 있는데 color_slot은 하나라 핑크 골드 장면에도 블랙 사진이 갔다
        # 사진이 실제로 있고 주 참조·상태 참조와 겹치지 않는 자리만 (라벨이 '실버 앞면'인 주 사진이 두 번 붙거나,
        # 사진 없는 컬러 자리를 골라 컬러 참조가 통째로 빠지지 않게)
        color_name = strip_hex(brief.color).strip()
        by_color = next(
            (
                s.key
                for s in profile.photo_slots
                if color_name and color_name in s.label and s.key != main and s.key not in stems
                and _find_reference(folder, s.key)
            ),
            None,
        )
        if (slot_key := by_color or profile.color_slot) and slot_key != main and slot_key not in stems:
            stems.append(slot_key)
    found = [Reference(product, captions[main])]
    found += [Reference(path, captions[stem]) for stem in stems if (path := _find_reference(folder, stem))]
    # 입력 화면에서 더 올린 제품 사진 (extra_1, extra_2 … 순서)
    found += [
        Reference(path, _EXTRA_CAPTION)
        for path in sorted(
            (p for p in folder.glob(f"{EXTRA_PREFIX}*") if p.suffix.lower() in _REFERENCE_SUFFIXES),
            key=lambda p: int(p.stem.removeprefix(EXTRA_PREFIX)),
        )
    ]
    if style := _find_reference(settings.product_image_dir, _STYLE_ANCHOR):
        found.append(Reference(style, _STYLE_CAPTION))
    return found


_ORIENTATIONS = {"portrait": "upright (portrait)", "landscape": "held sideways (landscape)"}


def state_guide(profile: ProductProfile) -> str:
    """연출안 작성자에게 주는 [제품 상태] 목록 (image_brief.md)."""
    lines = []
    for state in profile.states:
        notes = [state.brief_hint]
        if not state.shows_screen:
            notes.append("화면 안 보임 → screen_content는 '보이지 않음'")
        if state.orientation != "any":
            notes.append(f"orientation은 {state.orientation} 고정")
        lines.append(f"   - {state.key} ({state.label}): " + " / ".join(notes))
    return "\n".join(lines)


@lru_cache
def _model_sections() -> dict[str, str]:
    """image_model.md를 `## @이름` 섹션으로 나눈다. 메모 주석은 모델에 보내지 않는다."""
    text = re.sub(r"<!--.*?-->\s*", "", (PROMPT_DIR / "image_model.md").read_text(encoding="utf-8"), flags=re.DOTALL)
    parts = re.split(r"^## @(\S+)\s*$", text, flags=re.MULTILINE)
    return {name: body.strip() for name, body in zip(parts[1::2], parts[2::2])}


def _color_line(run: RunState, color: str) -> str:
    """헥스가 있으면 기준 톤으로 붙인다. 그대로 칠하지 말고 장면 조명·배경에 맞춰 자연스럽게 변하게 둔다."""
    code = run.input.color_hex(color)
    if not code:
        return color
    return (
        f"{color} — reference tone {code}. Keep this hue family so the color is clearly recognizable, "
        "but let it shift slightly with the scene's lighting, shadows and background reflections "
        "so it looks naturally photographed, not flat-filled with the exact code."
    )


def build_image_prompt(run: RunState, pod: str, layout: str, brief: ImageBrief) -> str:
    """공통 골격(image_model.md)과 제품 프로필의 제품별 블록 중 이 이미지에 필요한 것만 골라 붙이고,
    끝에 이 안의 연출안(Input Data)을 붙인다."""
    profile = run.input.product_profile
    state = profile.state(brief.state)
    # 손 블록은 이미지 유형으로 정한다 (person_hand 문구는 "없음(제품만)"처럼 흔들려서 판정에 쓰지 않음)
    has_person = brief.image_type in _PERSON_TYPES
    shows_screen = state.shows_screen and bool(profile.screen_rules.strip())
    common = _model_sections()
    blocks = [
        common["base"].replace("{device_noun}", profile.device_noun),
        f"# Device\n{profile.device_rules.strip()}",
        state.rules.strip(),
        *([f"# Screen\n{profile.screen_rules.strip()}", common["screen"]] if shows_screen else []),
        common["person"].replace("{person_rules}", profile.person_rules.strip() or _DEFAULT_PERSON_RULES)
        if has_person
        else common["no_person"],
        *([common["safe_zone"]] if layout == "L3" else []),
        common[f"mood_{run.input.mood}"],
    ]
    data = [
        f"- Pod : {pod}",
        f"- 타겟 페르소나 : {run.input.persona}",
        f"- 제품 컬러 : {_color_line(run, brief.color)}",
        f"- 제품 상태 : {state.key} ({state.label}), {_ORIENTATIONS[brief.orientation]}",
        f"- 장면 : {brief.scene}",
        f"- 소품 : {brief.props}",
        *([f"- 화면 콘텐츠 : {brief.screen_content}"] if shows_screen else []),
        *([f"- 인물/손 : {brief.person_hand}"] if has_person else []),
        f"- 구도 : {brief.composition}",
        f"- 화면비 : {brief.ratio}",
        *([f"- Quiet area : {brief.safe_zone}"] if layout == "L3" else []),
    ]
    body = "\n\n".join(blocks)
    check = common["check"].replace("{product_check}", profile.check.strip())
    return f"{body}\n\n# Input Data\n" + "\n".join(data) + f"\n\n{check}\n"


class ImageStep(Step):
    """Pod마다 슬롯 하나: LLM이 이미지 연출안(Input Data)을 쓰고 → 이미지 모델이 그린다."""

    name = "image"
    schema = ImageOption
    angles = [
        "제품 단독(Base) 클로즈업, 또는 제품을 실제로 쓰는 손과 함께한 클로즈업",
        "손이나 인물이 제품을 쓰는 장면",
        "공간·배경 연출이 돋보이는 장면",
    ]

    def _plan_item(self, run: RunState, pod: str) -> dict:
        return next(item for item in run.selected("pod")["items"] if item["pod"] == pod)

    def slots(self, run: RunState) -> list[str]:
        return [item["pod"] for item in run.selected("pod")["items"]]

    def build_context(self, run: RunState, slot: str) -> dict[str, str]:
        layout = self._plan_item(run, slot)["layout"]
        copy = next(p for p in run.selected("copy")["pods"] if p["pod"] == slot)
        profile = run.input.product_profile
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
            "visual_default": run.input.pod(slot).visual.strip() or "제품이 돋보이는 장면 (입력 데이터에 맞게)",
            "safe_zone_rule": safe_zone_rule,
            "headline": copy["headline"],
            "body": copy["body"],
            "target_scene": copy.get("target_scene") or "(없음 — 타겟 페르소나의 일상에서 고름)",
            "device_noun": profile.device_noun,
            "usage": profile.usage.strip() or _DEFAULT_USAGE,
            "state_guide": state_guide(profile),
            "visual_guide": profile.guide("visual"),
            "mood": run.input.mood,
            "mood_guide": MOOD_GUIDES[run.input.mood],
            "other_pods": self._other_pods(run, slot),
        }

    def _other_pods(self, run: RunState, slot: str) -> str:
        """다른 Pod에서 이미 쓴 장면·컬러 (Pod를 차례로 만들 때 겹치지 않게). 고른 안이 있으면 그것만, 없으면 만든 안 전부."""
        lines: list[str] = []
        colors: list[str] = []
        for pod, state in run.steps["image"].slots.items():
            if pod == slot or not state.options:
                continue
            chosen = [state.selected_option] if state.selected_option else state.options
            for option in chosen:
                brief = option.content.get("brief", {})
                lines.append(f"- {pod}: {brief.get('scene', '')} / {brief.get('image_type', '')} / {brief.get('color', '')}")
                colors.append(brief.get("color", ""))
        if not lines:
            return "(아직 없음)"
        unused = [c for c in run.input.color_list if c not in colors]
        hint = f"\n아직 쓰지 않은 컬러: {', '.join(unused)}" if unused else ""
        return "\n".join(lines) + hint

    async def generate_slot(
        self, run: RunState, slot: str, feedback: str | None = None, on_option: OnOption | None = None
    ) -> SlotState:
        """연출안 N개를 LLM 호출 한 번으로 쓰고(안끼리 겹치지 않게), 이미지는 안마다 따로 그려 끝나는 대로 알린다."""
        layout = self._plan_item(run, slot)["layout"]
        angles = [self.angles[i % len(self.angles)] for i in range(settings.num_options)]
        briefs = await self.with_retry(
            lambda: self._write_briefs(run, slot, layout, angles, feedback), f"{slot} 연출안"
        )
        jobs = [
            (option_label(angle, feedback), lambda brief=brief: self._draw(run, slot, layout, brief))
            for angle, brief in zip(angles, briefs)
        ]
        return await self.collect_options(run, slot, jobs, on_option)

    async def _write_briefs(
        self, run: RunState, slot: str, layout: str, angles: list[str], feedback: str | None
    ) -> list[ImageBrief]:
        if settings.llm_provider == "mock":
            return [self._mock_brief(run, slot, layout, angle, i) for i, angle in enumerate(angles)]
        return await self._ask_briefs(run, slot, angles, feedback)

    async def _ask_briefs(self, run: RunState, slot: str, angles: list[str], feedback: str | None) -> list[ImageBrief]:
        directions = "\n".join(f"{i + 1}안 : {angle}" for i, angle in enumerate(angles))
        result = await invoke_structured(
            "image_brief",
            ImageBriefs,
            {**self.build_context(run, slot), "angles": with_feedback(directions, feedback), "count": str(len(angles))},
        )
        if len(result.briefs) < len(angles):
            raise ValueError(f"연출안이 {len(angles)}개가 아니라 {len(result.briefs)}개 왔습니다.")
        allowed = {state.key for state in run.input.product_profile.states}
        if unknown := [b.state for b in result.briefs if b.state not in allowed]:
            raise ValueError(f"없는 제품 상태를 썼습니다: {', '.join(unknown)}")
        return result.briefs[: len(angles)]

    async def generate_option(
        self, run: RunState, slot: str, context: dict[str, str], angle: str, index: int
    ) -> ImageOption:
        raise NotImplementedError("이미지 단계는 generate_slot에서 연출안을 한 번에 쓴다")

    async def _draw(self, run: RunState, slot: str, layout: str, brief: ImageBrief) -> ImageOption:
        """연출안 하나로 이미지 한 장을 그린다. 실패해서 다시 시도해도 같은 연출안을 쓴다."""
        normalize_brief(brief, layout, run.input.product_profile)
        prompt = build_image_prompt(run, slot, layout, brief)
        out_dir = run_dir(run.id) / "images"
        out_dir.mkdir(parents=True, exist_ok=True)
        references = reference_images(run, brief)
        path = await get_image_provider().generate(
            prompt,
            references,
            out_dir,
            ratio=brief.ratio,
            label=f"{slot} · {brief.concept}",
            seed=random.randint(0, 2**31 - 1),
            pod=run.input.pod(slot).key,
        )
        mismatch = await check_product(path, references[0].path, run.input.product_profile.device_noun) if references else None
        return ImageOption(
            brief=brief, prompt=prompt, image_url=f"/api/files/{run.id}/images/{path.name}", product_mismatch=mismatch
        )

    async def revise_option(self, run: RunState, slot: str, content: ImageOption, request: str) -> ImageOption:
        """이미 만든 이미지 한 장을 사람의 요청대로 고친 새 안을 만든다. 연출안(brief)은 그대로 둔다."""
        images = run_dir(run.id) / "images"
        source = images / Path(content.image_url).name
        references = reference_images(run, content.brief)
        path = await get_image_provider().edit(
            source,
            request,
            references,
            images,
            ratio=content.brief.ratio,
            seed=random.randint(0, 2**31 - 1),
            pod=run.input.pod(slot).key,
            keep_rules=run.input.product_profile.edit_rules,
        )
        return ImageOption(
            brief=content.brief,
            prompt=f"{content.prompt}\n# Revision Request\n{request}\n",
            image_url=f"/api/files/{run.id}/images/{path.name}",
            product_mismatch=(
                await check_product(path, references[0].path, run.input.product_profile.device_noun)
                if references
                else None
            ),
        )

    def postprocess(self, run: RunState, slot: str, content: ImageOption) -> list[str]:
        layout = self._plan_item(run, slot)["layout"]
        normalize_brief(content.brief, layout, run.input.product_profile)
        warnings = check_brief(content.brief, layout, run.input.color_list, run.input.mood)
        if content.product_mismatch:
            warnings.append(
                f"제품 모양이 공식 사진과 다를 수 있습니다 (AI 판정): {content.product_mismatch}. "
                "크게 보고 확인한 뒤, 다르면 '수정 요청'이나 다시 생성을 해 주세요."
            )
        return warnings

    def _mock_brief(self, run: RunState, pod: str, layout: str, angle: str, index: int) -> ImageBrief:
        colors = run.input.color_list
        image_type = ("Base", "Hand-held", "배경 연출")[index % 3]
        states = run.input.product_profile.states
        state = states[index % len(states)]
        return ImageBrief(
            concept=f"[예시] {angle}",
            image_type=image_type,
            color=colors[index % len(colors)] if colors else "",
            state=state.key,
            orientation="landscape" if index % 3 == 1 else "portrait",
            scene=("[예시] 오후의 밝은 카페 창가", "[예시] 저녁의 거실 소파", "[예시] 아침의 사무실 책상")[index % 3],
            props="커피잔, 노트",
            screen_content="회색 막대와 컬러 블록으로 된 추상 UI",
            person_hand="한 손이 뒤에서 기기를 받침" if image_type == "Hand-held" else "없음",
            face="hidden" if image_type == "Hand-held" else "no person",  # mock: 손만
            composition=("정면 클로즈업, 왼쪽, 55%", "정면 미디엄, 가운데, 40%", "위에서 와이드, 오른쪽, 25%")[index % 3],
            ratio=LAYOUT_RATIOS[layout][0],
            safe_zone="하단 40% — 초점이 날아간 테이블 표면" if layout == "L3" else NO_SAFE_ZONE,
        )
