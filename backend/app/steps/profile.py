"""새 제품의 제품 프로필(프롬프트의 제품별 블록)을 AI가 만든다.

제품 정보와 기본 이미지(올린 사진)를 텍스트 LLM(Vertex Gemini, 이미지 입력 가능)에 보내고,
ProductProfile 규격대로 받아 코드가 다시 검사한다. 사진마다 어느 자리인지도 AI가 정하고, 사진이 부족하면 경고한다.
"""

import asyncio
import base64
import io
import logging

from langchain_core.messages import HumanMessage
from PIL import Image
from pydantic import BaseModel, Field

from app.config import settings
from app.core.domain import MAX_EXTRA_PRODUCT_IMAGES
from app.core.profile import FOLD_PROFILE, PhotoSlot, ProductProfile, ProductState
from app.core.prompts import load_prompt
from app.core.state import parse_colors
from app.core.store import upload_path
from app.llm import get_chat_model

logger = logging.getLogger(__name__)

MAX_PROFILE_IMAGES = 10
_LLM_IMAGE_SIDE = 1024  # 모델에 보낼 때 긴 변을 이 크기로 줄인다 (토큰·전송량)
_ATTEMPTS = 3


class PhotoAssignment(BaseModel):
    image_index: int = Field(description="첨부 사진 번호 (1부터)")
    slot: str = Field(description="배정한 사진 자리 key")


class PodVisual(BaseModel):
    pod: str
    visual: str


class ProfileDraft(BaseModel):
    profile: ProductProfile
    photo_assignments: list[PhotoAssignment]
    pod_visuals: list[PodVisual] = []
    warnings: list[str] = []


class ProfilePod(BaseModel):
    name: str
    spec: str = ""


class ProfileRequest(BaseModel):
    product_name: str = Field(min_length=1)
    colors: str = ""
    pods: list[ProfilePod] = []
    images: list[str] = Field(min_length=1, max_length=MAX_PROFILE_IMAGES, description="올린 사진 파일 이름")


class ProfileResult(BaseModel):
    """입력 화면에 바로 채울 수 있는 모양."""

    profile: ProductProfile
    product_images: dict[str, str]  # 사진 자리 → 올린 파일 이름
    extra_product_images: list[str]  # 자리로 쓰지 않은 사진
    pod_visuals: dict[str, str]
    warnings: list[str]


def _image_block(name: str) -> dict:
    with Image.open(upload_path(name)) as image:
        image = image.convert("RGB")
        image.thumbnail((_LLM_IMAGE_SIDE, _LLM_IMAGE_SIDE))
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", quality=85)
    data = base64.b64encode(buffer.getvalue()).decode()
    return {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{data}"}}


async def _ask(request: ProfileRequest) -> ProfileDraft:
    pods = "\n".join(f"  - {pod.name} : {pod.spec.strip() or '(입력 데이터 없음)'}" for pod in request.pods)
    system, human = load_prompt("profile").format_messages(
        example=FOLD_PROFILE.model_dump_json(indent=1),
        product_name=request.product_name,
        colors=", ".join(name for name, _ in parse_colors(request.colors)) or "(없음)",
        pods=pods or "  (없음)",
        count=str(len(request.images)),
    )
    content: list[dict] = [{"type": "text", "text": str(human.content)}]
    for i, name in enumerate(request.images, 1):
        content += [{"type": "text", "text": f"[사진 {i}]"}, _image_block(name)]
    model = get_chat_model().with_structured_output(ProfileDraft, method="json_schema")
    return await asyncio.wait_for(model.ainvoke([system, HumanMessage(content=content)]), settings.llm_timeout * 3)


def _mock_draft(request: ProfileRequest) -> ProfileDraft:
    """LLM_PROVIDER=mock: 첫 사진 하나를 정면 자리로 쓰는 최소 프로필."""
    return ProfileDraft(
        profile=ProductProfile(
            device_noun=f"[mock] {request.product_name}",
            device_rules="- [mock] Keep the exact shape shown in the product photo.\n- Body color exactly [제품 컬러].",
            check="the side named above facing the camera · its own proportion",
            edit_rules="- Keep the exact shape, proportion and body color of the product photo.",
            photo_slots=[PhotoSlot(key="front", label="정면", caption="[Product reference — FRONT.]", required=True)],
            states=[
                ProductState(
                    key="front", label="정면", brief_hint="[예시] 제품 정면이 보임", rules="# This view: FRONT",
                    shows_screen=False, orientation="any", photos=["front"],
                )
            ],
            reference_color=next((name for name, _ in parse_colors(request.colors)), ""),
        ),
        photo_assignments=[PhotoAssignment(image_index=1, slot="front")],
        pod_visuals=[PodVisual(pod=pod.name, visual=f"[예시] {pod.name}이 돋보이는 장면") for pod in request.pods],
        warnings=["[예시] mock 모드라 사진을 보지 않고 첫 사진만 정면으로 썼습니다."],
    )


def _to_result(request: ProfileRequest, draft: ProfileDraft) -> ProfileResult:
    """사진 배정을 입력 화면의 모양으로 바꾸고, 배정되지 않은 자리·사진을 정리한다."""
    profile = draft.profile
    slots = set(profile.slot_labels())
    product_images: dict[str, str] = {}
    used: set[int] = set()
    for assignment in draft.photo_assignments:
        index = assignment.image_index - 1
        if assignment.slot in slots and assignment.slot not in product_images and 0 <= index < len(request.images):
            product_images[assignment.slot] = request.images[index]
            used.add(index)
    extras = [name for i, name in enumerate(request.images) if i not in used]
    warnings = list(draft.warnings)
    if len(extras) > MAX_EXTRA_PRODUCT_IMAGES:
        warnings.append(f"자리에 배정되지 않은 사진이 많아 {MAX_EXTRA_PRODUCT_IMAGES}장만 추가 사진으로 보냅니다.")
    pod_names = {pod.name for pod in request.pods}
    return ProfileResult(
        profile=profile,
        product_images=product_images,
        extra_product_images=extras[:MAX_EXTRA_PRODUCT_IMAGES],
        pod_visuals={v.pod: v.visual for v in draft.pod_visuals if v.pod in pod_names},
        warnings=warnings,
    )


def _check_draft(request: ProfileRequest, draft: ProfileDraft) -> None:
    """규격 검사는 ProductProfile이 하고, 여기서는 주 참조 자리에 실제 사진이 배정됐는지 본다."""
    assigned = {a.slot for a in draft.photo_assignments if 1 <= a.image_index <= len(request.images)}
    if not assigned:
        raise ValueError("사진을 하나도 자리에 배정하지 않았습니다.")
    mains = {state.photos[0] for state in draft.profile.states}
    if not mains & assigned:
        raise ValueError("어떤 제품 상태도 주 참조 사진이 없습니다.")


async def generate_profile(request: ProfileRequest) -> ProfileResult:
    if settings.llm_provider == "mock":
        return _to_result(request, _mock_draft(request))
    error: Exception | None = None
    for attempt in range(1, _ATTEMPTS + 1):
        try:
            draft = await _ask(request)
            _check_draft(request, draft)
            result = _to_result(request, draft)
            # 주 참조 사진이 없는 상태는 그릴 수 없으므로 빼고 알린다
            states = [s for s in result.profile.states if s.photos[0] in result.product_images]
            if dropped := [s.label for s in result.profile.states if s not in states]:
                result.warnings.append(f"주 참조 사진이 없어 뺀 상태: {', '.join(dropped)}")
                result.profile = result.profile.model_copy(update={"states": states})
            return result
        except Exception as e:  # 규격 위반·형식 오류·일시 오류는 다시 시도
            error = e
            logger.warning("제품 프로필 생성 실패 (%d/%d)", attempt, _ATTEMPTS, exc_info=True)
    raise RuntimeError(f"제품 프로필을 만들지 못했습니다: {error}")
