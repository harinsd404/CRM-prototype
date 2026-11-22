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

# 인물 묘사에 쓰면 얼굴이 화면에 들어오는 말 (face hidden 위반). "눈높이"(카메라 각도)·"눈이 내리는"·"코트" 같은 말은 걸리지 않게 좁게 잡는다
_FACE_WORDS = re.compile(r"얼굴|옆모습|표정|미소|웃는|입가|입술|입 ?(가까이|근처|앞|쪽|높이)|눈(을|빛|썹)|시선|콧|코끝|턱(을|이|선| 아래| 근처)?|머리를 숙|고개")
_PERSON_TYPES = ("Hand-held", "인물 포함")
_FACE_CHECK_SIDE = 768  # 얼굴 판정용으로 줄여 보내는 크기

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
    face: Literal["hidden", "no person"]
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
    face_visible: bool | None = None  # 완성 이미지에 얼굴이 보이는지 (인물이 있는 안만 판정, 판정 못 하면 None)


class FaceCheck(BaseModel):
    face_visible: bool = Field(description="사람 얼굴의 일부(눈·코·입·입술·턱·옆얼굴)가 조금이라도 보이면 true")
    note: str = Field(description="보이는 부위를 한국어로 짧게, 없으면 빈 문자열")


def face_words(brief: ImageBrief) -> list[str]:
    """인물 묘사·구도에 얼굴이 들어오는 말이 있는지."""
    text = f"{brief.person_hand} {brief.composition}"
    return list(dict.fromkeys(m.group(0) for m in _FACE_WORDS.finditer(text)))


def _face_words_in(briefs: list[ImageBrief]) -> list[str]:
    return list(dict.fromkeys(w for b in briefs if b.image_type in _PERSON_TYPES for w in face_words(b)))


async def check_face(path: Path) -> bool | None:
    """완성 이미지에 얼굴이 보이는지 텍스트 모델(이미지 입력)에게 묻는다. 경고용이라 실패하면 None."""
    if settings.llm_provider == "mock":
        return None
    try:
        with Image.open(path) as image:
            image = image.convert("RGB")
            image.thumbnail((_FACE_CHECK_SIDE, _FACE_CHECK_SIDE))
            buffer = io.BytesIO()
            image.save(buffer, "JPEG", quality=85)
        data = base64.b64encode(buffer.getvalue()).decode()
        message = HumanMessage(
            content=[
                {
                    "type": "text",
                    "text": "이 광고 사진에 사람 얼굴의 일부(눈, 코, 입, 입술, 턱, 옆얼굴)가 조금이라도 보이나요? "
                    "뒤통수만 보이거나 손·팔·목 아래 몸만 보이면 false입니다.",
                },
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{data}"}},
            ]
        )
        model = get_chat_model().with_structured_output(FaceCheck, method="json_schema")
        result = await asyncio.wait_for(model.ainvoke([message]), settings.llm_timeout)
        return result.face_visible
    except Exception:
        logger.warning("얼굴 판정 실패: %s", path.name, exc_info=True)
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


def check_brief(brief: ImageBrief, layout: str, colors: list[str]) -> list[str]:
    warnings = []
    if colors and brief.color not in colors:
        warnings.append(f"제품 컬러 '{brief.color}'가 입력 컬러 라인업에 없습니다.")
    if layout == "L3" and (words := [w for w in _SAFE_ZONE_BANNED if w in brief.safe_zone]):
        warnings.append(f"Safe Zone 설명에 금지어가 있습니다: {', '.join(words)}")
    if brief.face == "hidden" and brief.person_hand in ("", "없음"):
        warnings.append("얼굴이 hidden인데 인물/손 묘사가 없습니다.")
    if brief.image_type in _PERSON_TYPES and brief.person_hand in ("", "없음"):
        warnings.append(f"이미지 유형이 {brief.image_type}인데 인물/손 묘사가 없습니다.")
    if brief.image_type in _PERSON_TYPES and (words := face_words(brief)):
        warnings.append(f"인물 묘사에 얼굴이 들어오는 말이 있습니다: {', '.join(words)}")
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
    if profile.color_slot and profile.reference_color not in brief.color and profile.color_slot not in stems:
        stems.append(profile.color_slot)
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
        *([f"# Screen\n{profile.screen_rules.strip()}"] if shows_screen else []),
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
        *([f"- 인물/손 : {brief.person_hand}", "- 프레이밍 : 얼굴 없음 — 이미지 위쪽 끝은 턱 아래(목·어깨)에서 자른다"] if has_person else []),
        f"- 구도 : {brief.composition}",
        f"- 화면비 : {brief.ratio}",
        *([f"- Quiet area : {brief.safe_zone}"] if layout == "L3" else []),
    ]
    body = "\n\n".join(blocks)
    check = common["check"].replace("{product_check}", profile.check.strip())
    if has_person:
        check = check.rstrip() + " · no face (nothing above the chin)"
    return f"{body}\n\n# Input Data\n" + "\n".join(data) + f"\n\n{check}\n"


class ImageStep(Step):
    """Pod마다 슬롯 하나: LLM이 이미지 연출안(Input Data)을 쓰고 → 이미지 모델이 그린다."""

    name = "image"
    schema = ImageOption
    angles = [
        "제품 단독(Base) 클로즈업, 또는 제품을 실제로 쓰는 손과 함께한 클로즈업",
        "손이나 인물(얼굴 비노출)이 제품을 쓰는 장면",
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
        }

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
        briefs = await self._ask_briefs(run, slot, angles, feedback)
        # 얼굴이 들어오는 연출안은 그대로 그리면 얼굴이 나오기 쉽다 → 이유를 알려 주고 한 번 다시 쓰게 한다.
        # 그래도 남으면 실패시키지 않는다 (이미지 프롬프트의 No face 규칙과 완성 이미지 판정이 다시 막고, 안에 경고가 남는다).
        if faces := _face_words_in(briefs):
            note = (
                f"직전 연출안이 얼굴이 들어오는 말({', '.join(faces)})을 썼습니다. 인물은 어깨 아래로 자르고, "
                "제품을 얼굴 쪽으로 드는 동작은 손과 제품만 가깝게 찍는 클로즈업으로 바꿔 쓰세요."
            )
            retry = await self._ask_briefs(run, slot, angles, f"{feedback}\n{note}" if feedback else note)
            if len(_face_words_in(retry)) < len(faces):
                briefs = retry
            logger.info("%s 연출안 얼굴 단어 %s → 다시 쓴 뒤 %s", slot, faces, _face_words_in(briefs))
        return briefs

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
        path = await get_image_provider().generate(
            prompt,
            reference_images(run, brief),
            out_dir,
            ratio=brief.ratio,
            label=f"{slot} · {brief.concept}",
            seed=random.randint(0, 2**31 - 1),
            pod=run.input.pod(slot).key,
        )
        face = await check_face(path) if brief.image_type in _PERSON_TYPES else None
        return ImageOption(
            brief=brief, prompt=prompt, image_url=f"/api/files/{run.id}/images/{path.name}", face_visible=face
        )

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
            pod=run.input.pod(slot).key,
            keep_rules=run.input.product_profile.edit_rules,
        )
        return ImageOption(
            brief=content.brief,
            prompt=f"{content.prompt}\n# Revision Request\n{request}\n",
            image_url=f"/api/files/{run.id}/images/{path.name}",
            # 고친 이미지는 손·인물을 새로 넣었을 수도 있으니 유형과 상관없이 본다
            face_visible=await check_face(path),
        )

    def postprocess(self, run: RunState, slot: str, content: ImageOption) -> list[str]:
        layout = self._plan_item(run, slot)["layout"]
        normalize_brief(content.brief, layout, run.input.product_profile)
        warnings = check_brief(content.brief, layout, run.input.color_list)
        if content.face_visible:
            warnings.append("이미지에 얼굴이 보입니다 (AI 판정). 이 안을 쓰려면 '수정 요청'으로 얼굴을 잘라 주세요.")
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
            face="hidden" if image_type == "Hand-held" else "no person",
            composition=("정면 클로즈업, 왼쪽, 55%", "정면 미디엄, 가운데, 40%", "위에서 와이드, 오른쪽, 25%")[index % 3],
            ratio=LAYOUT_RATIOS[layout][0],
            safe_zone="하단 40% — 초점이 날아간 테이블 표면" if layout == "L3" else NO_SAFE_ZONE,
        )
