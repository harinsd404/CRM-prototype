"""제품 템플릿 읽기·쓰기. 템플릿은 모든 사용자가 함께 쓴다."""

from datetime import datetime

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select

from app.core.db import Template, TemplatePod, User, session_scope
from app.core.domain import MAX_PODS
from app.core.seed import FOLD_TEMPLATE
from app.core.state import PodInput


class TemplatePodData(PodInput):
    enabled: bool = Field(default=True, description="새 실행에서 기본으로 켜 둘지")


class TemplateData(BaseModel):
    """템플릿을 만들거나 덮어쓸 때 받는 값."""

    name: str = Field(min_length=1, max_length=100)
    product_name: str = Field(min_length=1, max_length=200)
    colors: str = ""
    pods: list[TemplatePodData] = Field(min_length=1, max_length=MAX_PODS)

    @model_validator(mode="after")
    def _check(self) -> "TemplateData":
        self.name = self.name.strip()
        names = [pod.name for pod in self.pods]
        if len(set(names)) < len(names):
            raise ValueError("Pod 이름이 겹칩니다.")
        for i, pod in enumerate(self.pods, 1):
            pod.key = pod.key or f"pod{i}"
        keys = [pod.key for pod in self.pods]
        if len(set(keys)) < len(keys):
            raise ValueError("Pod 영문 이름이 겹칩니다.")
        return self


class TemplateOut(TemplateData):
    id: int
    updated_at: datetime
    updated_by: str | None  # 마지막으로 고친 사람 아이디


class TemplateSummary(BaseModel):
    id: int
    name: str
    product_name: str
    pod_count: int
    updated_at: datetime
    updated_by: str | None


class TemplateNameTaken(ValueError):
    pass


def _usernames(db, ids: set[int | None]) -> dict[int, str]:
    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    return dict(db.execute(select(User.id, User.username).where(User.id.in_(ids))).all())


def _to_out(template: Template, usernames: dict[int, str]) -> TemplateOut:
    return TemplateOut(
        id=template.id,
        name=template.name,
        product_name=template.product_name,
        colors=template.colors,
        pods=[
            TemplatePodData(name=p.name, key=p.key, spec=p.spec, visual=p.visual, enabled=p.enabled)
            for p in template.pods
        ],
        updated_at=template.updated_at,
        updated_by=usernames.get(template.updated_by) if template.updated_by else None,
    )


def list_templates() -> list[TemplateSummary]:
    """최근에 고친 순서."""
    with session_scope() as db:
        templates = db.scalars(select(Template).order_by(Template.updated_at.desc())).all()
        usernames = _usernames(db, {t.updated_by for t in templates})
        return [
            TemplateSummary(
                id=t.id,
                name=t.name,
                product_name=t.product_name,
                pod_count=len(t.pods),
                updated_at=t.updated_at,
                updated_by=usernames.get(t.updated_by) if t.updated_by else None,
            )
            for t in templates
        ]


def get_template(template_id: int) -> TemplateOut | None:
    with session_scope() as db:
        template = db.get(Template, template_id)
        if template is None:
            return None
        return _to_out(template, _usernames(db, {template.updated_by}))


def _apply(template: Template, data: TemplateData) -> None:
    template.name = data.name
    template.product_name = data.product_name.strip()
    template.colors = data.colors.strip()
    template.pods = [
        TemplatePod(position=i, name=p.name, key=p.key, spec=p.spec, visual=p.visual, enabled=p.enabled)
        for i, p in enumerate(data.pods)
    ]


def _check_name(db, name: str, exclude_id: int | None = None) -> None:
    query = select(Template.id).where(Template.name == name)
    if exclude_id is not None:
        query = query.where(Template.id != exclude_id)
    if db.scalar(query) is not None:
        raise TemplateNameTaken(f"같은 이름의 템플릿이 이미 있습니다: {name}")


def create_template(data: TemplateData, user_id: int | None) -> TemplateOut:
    with session_scope() as db:
        _check_name(db, data.name)
        template = Template(created_by=user_id, updated_by=user_id)
        _apply(template, data)
        db.add(template)
        db.flush()
        return _to_out(template, _usernames(db, {user_id}))


def update_template(template_id: int, data: TemplateData, user_id: int) -> TemplateOut | None:
    """템플릿 내용을 통째로 바꾼다. 이 템플릿으로 만든 예전 실행은 실행에 복사해 둔 입력을 쓰므로 바뀌지 않는다."""
    with session_scope() as db:
        template = db.get(Template, template_id)
        if template is None:
            return None
        _check_name(db, data.name, exclude_id=template_id)
        template.pods.clear()
        db.flush()  # 같은 Pod 이름으로 다시 넣을 때 (template_id, name) 고유 제약에 걸리지 않게 먼저 지운다
        _apply(template, data)
        template.updated_by = user_id
        template.updated_at = datetime.now()
        db.flush()
        return _to_out(template, _usernames(db, {user_id}))


def seed_templates() -> None:
    """템플릿이 하나도 없으면 Galaxy Z Fold 기본 템플릿을 넣는다."""
    with session_scope() as db:
        if db.scalar(select(func.count()).select_from(Template)):
            return
    create_template(TemplateData.model_validate(FOLD_TEMPLATE), None)
