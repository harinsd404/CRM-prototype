from fastapi import APIRouter, HTTPException

from app.api.auth import CurrentUser
from app.core import templates
from app.core.templates import TemplateData, TemplateNameTaken, TemplateOut, TemplateSummary

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


@router.put("/{template_id}", response_model=TemplateOut)
def update_template(template_id: int, body: TemplateData, user: CurrentUser) -> TemplateOut:
    """템플릿을 덮어쓴다 (모두가 함께 쓰는 템플릿이라 누구나 고칠 수 있다)."""
    try:
        template = templates.update_template(template_id, body, user.id)
    except TemplateNameTaken as e:
        raise HTTPException(409, str(e)) from e
    if template is None:
        raise HTTPException(404, f"템플릿을 찾을 수 없습니다: {template_id}")
    return template
