import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.auth import CurrentUser
from app.core import feedback, guard, templates
from app.core.profile import FOLD_PROFILE, ProductProfile
from app.core.templates import (
    ProfileConflict,
    ProfileVersionOut,
    TemplateData,
    TemplateNameTaken,
    TemplateOut,
    TemplateSummary,
)
from app.steps.improve import note_text, propose

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("", response_model=list[TemplateSummary])
def list_templates(user: CurrentUser) -> list[TemplateSummary]:
    return templates.list_templates()


@router.get("/{template_id}", response_model=TemplateOut)
def get_template(template_id: int, user: CurrentUser) -> TemplateOut:
    template = templates.get_template(template_id)
    if template is None:
        raise HTTPException(404, f"템플릿을 찾을 수 없습니다: {template_id}")
    return template


@router.post("", response_model=TemplateOut)
def create_template(body: TemplateData, user: CurrentUser) -> TemplateOut:
    try:
        return templates.create_template(body, user.id)
    except TemplateNameTaken as e:
        raise HTTPException(409, str(e)) from e
    except ValueError as e:  # 올린 사진을 찾을 수 없음
        raise HTTPException(400, str(e)) from e


@router.put("/{template_id}", response_model=TemplateOut)
def update_template(template_id: int, body: TemplateData, user: CurrentUser) -> TemplateOut:
    """템플릿을 덮어쓴다 (모두가 함께 쓰는 템플릿이라 누구나 고칠 수 있다)."""
    try:
        template = templates.update_template(template_id, body, user.id)
    except TemplateNameTaken as e:
        raise HTTPException(409, str(e)) from e
    except ValueError as e:  # 올린 사진을 찾을 수 없음
        raise HTTPException(400, str(e)) from e
    if template is None:
        raise HTTPException(404, f"템플릿을 찾을 수 없습니다: {template_id}")
    return template


# ── 템플릿 메뉴: 제품 프로필 직접 수정·버전·피드백 개선안 ─────────────────────


def _template_or_404(template_id: int) -> TemplateOut:
    template = templates.get_template(template_id)
    if template is None:
        raise HTTPException(404, f"템플릿을 찾을 수 없습니다: {template_id}")
    return template


@router.get("/{template_id}/profile/versions", response_model=list[ProfileVersionOut])
def profile_versions(template_id: int, user: CurrentUser) -> list[ProfileVersionOut]:
    _template_or_404(template_id)
    return templates.list_profile_versions(template_id)


class SaveProfileRequest(BaseModel):
    profile: ProductProfile
    note: str = Field(default="", max_length=1000)
    base_version: int | None = Field(default=None, description="고치기 시작할 때의 버전. 그 뒤로 바뀌었으면 409")


class SaveProfileResult(BaseModel):
    version: int | None  # 만든 버전. 지금 쓰는 규칙과 같아(코드가 정리한 뒤) 만들지 않았으면 null


@router.put("/{template_id}/profile", response_model=SaveProfileResult)
def save_profile(template_id: int, body: SaveProfileRequest, user: CurrentUser) -> SaveProfileResult:
    """템플릿 메뉴에서 고친 프로필을 새 버전으로 저장한다 (모든 사용자에게 바로 쓰인다)."""
    _template_or_404(template_id)
    note = body.note.strip() or "템플릿 메뉴에서 직접 고침"
    try:
        version = templates.save_profile(template_id, body.profile, user.id, note, body.base_version)
    except ProfileConflict as e:
        raise HTTPException(409, f"{e} 다시 불러온 뒤 고쳐 주세요.") from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return SaveProfileResult(version=version)


@router.post("/{template_id}/profile/propose", response_model=ProfileVersionOut)
async def propose_profile(template_id: int, user: CurrentUser) -> ProfileVersionOut:
    """이 템플릿의 '확인 전' 피드백으로 AI가 프로필 개선안을 만든다. 승인 전까지는 쓰이지 않는다."""
    template = _template_or_404(template_id)
    items = feedback.list_feedback(user.id, template_id=template_id, status="open")
    if not items:
        raise HTTPException(400, "이 템플릿에 확인 전 피드백이 없습니다.")
    guard.check_generate_rate()
    current = template.profile or FOLD_PROFILE
    try:
        draft = await propose(current, items)
    except Exception as e:
        logger.exception("프로필 개선안 생성 실패")
        raise HTTPException(502, str(e)) from e
    return templates.add_proposal(
        template_id, draft.profile, user.id, note_text(draft), draft.addressed_feedback, template.profile_version
    )


@router.post("/{template_id}/profile/versions/{version}/activate", response_model=ProfileVersionOut)
def activate(template_id: int, version: int, user: CurrentUser) -> ProfileVersionOut:
    """개선안 승인 또는 예전 버전으로 되돌리기. 개선안을 승인하면 반영한 피드백을 '반영함'으로 바꾼다."""
    _template_or_404(template_id)
    try:
        activated = templates.activate_version(template_id, version, user.id)
    except ProfileConflict as e:
        raise HTTPException(409, f"{e} 승인하면 그 내용이 사라지므로 개선안을 다시 만들어 주세요.") from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if activated is None:
        raise HTTPException(400, "되돌리거나 승인할 수 있는 버전이 아닙니다.")
    return activated


@router.post("/{template_id}/profile/versions/{version}/reject", response_model=dict)
def reject(template_id: int, version: int, user: CurrentUser) -> dict:
    if not templates.reject_version(template_id, version):
        raise HTTPException(400, "거절할 수 있는 개선안이 아닙니다.")
    return {"ok": True}
