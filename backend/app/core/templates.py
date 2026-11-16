"""제품 템플릿 읽기·쓰기. 템플릿은 모든 사용자가 함께 쓴다."""

from datetime import datetime

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select

from app.core.db import ProfileVersion, Template, TemplateImage, TemplatePod, User, session_scope
from app.core.domain import MAX_EXTRA_PRODUCT_IMAGES, MAX_PODS
from app.core.profile import FOLD_PROFILE, ProductProfile
from app.core.seed import FOLD_TEMPLATE
from app.core.state import PodInput, RunState
from app.core.store import default_product_image, run_product_images_as_uploads, save_as_upload, upload_path

EXTRA_ROLE = "extra"


class TemplatePodData(PodInput):
    enabled: bool = Field(default=True, description="새 실행에서 기본으로 켜 둘지")


class TemplateData(BaseModel):
    """템플릿을 만들거나 덮어쓸 때 받는 값."""

    name: str = Field(min_length=1, max_length=100)
    product_name: str = Field(min_length=1, max_length=200)
    colors: str = ""
    pods: list[TemplatePodData] = Field(min_length=1, max_length=MAX_PODS)
    # 기본 이미지. RunInput과 같은 이름이지만 여기서는 '있는 자리만' 적는다 (없는 자리 = 사진 없음)
    product_images: dict[str, str] = Field(default={}, description="사진 자리 → 올린 파일 이름")
    extra_product_images: list[str] = Field(default=[], max_length=MAX_EXTRA_PRODUCT_IMAGES)
    # 프롬프트의 제품별 블록. 저장할 때 바뀌었으면 새 버전으로 남긴다 (profile_versions)
    profile: ProductProfile | None = None

    @model_validator(mode="after")
    def _check(self) -> "TemplateData":
        self.name = self.name.strip()
        if unknown := set(self.product_images) - set((self.profile or FOLD_PROFILE).slot_labels()):
            raise ValueError(f"알 수 없는 사진 자리: {', '.join(sorted(unknown))}")
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


def active_profile(db, template_id: int) -> ProfileVersion | None:
    return db.scalar(
        select(ProfileVersion).where(ProfileVersion.template_id == template_id, ProfileVersion.status == "active")
    )


def _set_profile(db, template_id: int, profile: ProductProfile | None, user_id: int | None, source: str, note: str = "") -> None:
    """프로필이 바뀌었으면 새 버전을 active로 넣고 이전 것은 archived로 남긴다."""
    if profile is None:
        return
    current = active_profile(db, template_id)
    content = profile.model_dump_json()
    if current is not None and ProductProfile.model_validate_json(current.profile) == profile:
        return
    last = db.scalar(select(func.max(ProfileVersion.version)).where(ProfileVersion.template_id == template_id)) or 0
    if current is not None:
        current.status = "archived"
    db.add(
        ProfileVersion(
            template_id=template_id, version=last + 1, profile=content, status="active",
            source=source, note=note, created_by=user_id,
        )
    )


def _to_out(template: Template, usernames: dict[int, str], db) -> TemplateOut:
    version = active_profile(db, template.id)
    profile = ProductProfile.model_validate_json(version.profile) if version else None
    return TemplateOut(
        id=template.id,
        name=template.name,
        product_name=template.product_name,
        colors=template.colors,
        pods=[
            TemplatePodData(name=p.name, key=p.key, spec=p.spec, visual=p.visual, enabled=p.enabled)
            for p in template.pods
        ],
        product_images={i.role: i.file for i in template.images if i.role != EXTRA_ROLE},
        extra_product_images=[i.file for i in template.images if i.role == EXTRA_ROLE],
        profile=profile,
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
        return _to_out(template, _usernames(db, {template.updated_by}), db)


def _apply(template: Template, data: TemplateData) -> None:
    # 저장할 때만 파일을 확인한다 (읽을 때 확인하면 사진 하나가 지워져도 템플릿을 열 수 없게 된다)
    for name in [*data.product_images.values(), *data.extra_product_images]:
        upload_path(name)  # 없는 파일이면 ValueError
    template.name = data.name
    template.product_name = data.product_name.strip()
    template.colors = data.colors.strip()
    template.pods = [
        TemplatePod(position=i, name=p.name, key=p.key, spec=p.spec, visual=p.visual, enabled=p.enabled)
        for i, p in enumerate(data.pods)
    ]
    template.images = [TemplateImage(role=role, file=file) for role, file in data.product_images.items()] + [
        TemplateImage(role=EXTRA_ROLE, file=file, position=i) for i, file in enumerate(data.extra_product_images)
    ]


def check_name_free(name: str, exclude_id: int | None = None) -> None:
    """같은 이름의 다른 템플릿이 있으면 TemplateNameTaken."""
    with session_scope() as db:
        _check_name(db, name.strip(), exclude_id)


def _check_name(db, name: str, exclude_id: int | None = None) -> None:
    query = select(Template.id).where(Template.name == name)
    if exclude_id is not None:
        query = query.where(Template.id != exclude_id)
    if db.scalar(query) is not None:
        raise TemplateNameTaken(f"같은 이름의 템플릿이 이미 있습니다: {name}")


def create_template(data: TemplateData, user_id: int | None, source: str = "manual") -> TemplateOut:
    with session_scope() as db:
        _check_name(db, data.name)
        template = Template(created_by=user_id, updated_by=user_id)
        _apply(template, data)
        db.add(template)
        db.flush()
        _set_profile(db, template.id, data.profile, user_id, source)
        return _to_out(template, _usernames(db, {user_id}), db)


def update_template(template_id: int, data: TemplateData, user_id: int, source: str = "manual") -> TemplateOut | None:
    """템플릿 내용을 통째로 바꾼다. 이 템플릿으로 만든 예전 실행은 실행에 복사해 둔 입력을 쓰므로 바뀌지 않는다."""
    with session_scope() as db:
        template = db.get(Template, template_id)
        if template is None:
            return None
        _check_name(db, data.name, exclude_id=template_id)
        template.pods.clear()
        template.images.clear()
        db.flush()  # 같은 Pod 이름으로 다시 넣을 때 (template_id, name) 고유 제약에 걸리지 않게 먼저 지운다
        _apply(template, data)
        _set_profile(db, template.id, data.profile, user_id, source)
        template.updated_by = user_id
        template.updated_at = datetime.now()
        db.flush()
        return _to_out(template, _usernames(db, {user_id}), db)


def _default_images() -> dict[str, str]:
    """assets/product의 기본 사진을 올린 사진 폴더로 복사한다."""
    return {role: save_as_upload(path) for role in FOLD_PROFILE.slot_labels() if (path := default_product_image(role))}


def seed_templates() -> None:
    """템플릿이 하나도 없으면 Galaxy Z Fold 기본 템플릿을 넣는다 (기본 이미지 = assets/product 사진).
    이미지 기능 전에 만든 Fold 템플릿에 사진이 하나도 없으면 사진만 채운다."""
    with session_scope() as db:
        if db.scalar(select(func.count()).select_from(Template)):
            fold = db.scalar(select(Template).where(Template.name == FOLD_TEMPLATE["name"]))
            if fold is not None and not fold.images:
                fold.images = [TemplateImage(role=role, file=file) for role, file in _default_images().items()]
            if fold is not None and active_profile(db, fold.id) is None:
                _set_profile(db, fold.id, FOLD_PROFILE, None, "seed", "기존 코드의 Fold 규칙")
            return
    create_template(
        TemplateData.model_validate({**FOLD_TEMPLATE, "product_images": _default_images(), "profile": FOLD_PROFILE}),
        None,
        source="seed",
    )


def template_data_from_run(run: RunState, name: str, base: TemplateOut | None) -> TemplateData:
    """실행의 제품 정보·Pod·제품 사진으로 템플릿 내용을 만든다.
    덮어쓸 템플릿(base)에 있는데 이번 실행에서 끈 Pod는 지우지 않고 꺼진 채로 뒤에 남긴다."""
    pods = [TemplatePodData(**pod.model_dump(), enabled=True) for pod in run.input.pods]
    if base is not None:
        used = set(run.input.pod_names)
        pods += [pod.model_copy(update={"enabled": False}) for pod in base.pods if pod.name not in used]
    images, extras = run_product_images_as_uploads(run)
    return TemplateData(
        name=name,
        product_name=run.input.product_name,
        colors=run.input.colors,
        pods=pods[:MAX_PODS],
        product_images=images,
        extra_product_images=extras[:MAX_EXTRA_PRODUCT_IMAGES],
        profile=run.input.product_profile,
    )


# ── 제품 프로필 버전 (고급 모드) ─────────────────────────────────────────


class ProfileVersionOut(BaseModel):
    version: int
    status: str  # active / archived / proposed / rejected
    source: str
    note: str
    feedback_ids: list[int]
    created_by: str | None
    created_at: datetime
    profile: ProductProfile


def list_profile_versions(template_id: int) -> list[ProfileVersionOut]:
    """최근 버전부터."""
    with session_scope() as db:
        versions = db.scalars(
            select(ProfileVersion).where(ProfileVersion.template_id == template_id).order_by(ProfileVersion.version.desc())
        ).all()
        usernames = _usernames(db, {v.created_by for v in versions})
        return [
            ProfileVersionOut(
                version=v.version,
                status=v.status,
                source=v.source,
                note=v.note,
                feedback_ids=[int(i) for i in v.feedback_ids.split(",") if i],
                created_by=usernames.get(v.created_by) if v.created_by else None,
                created_at=v.created_at,
                profile=ProductProfile.model_validate_json(v.profile),
            )
            for v in versions
        ]


def save_profile(template_id: int, profile: ProductProfile, user_id: int, note: str, source: str = "manual") -> bool:
    """고급 모드에서 고친 프로필을 새 active 버전으로. 템플릿이 없으면 False."""
    with session_scope() as db:
        template = db.get(Template, template_id)
        if template is None:
            return False
        _check_slots_kept(db, template, profile)
        _set_profile(db, template_id, profile, user_id, source, note)
        template.updated_by, template.updated_at = user_id, datetime.now()
        return True


def _check_slots_kept(db, template: Template, profile: ProductProfile) -> None:
    """템플릿에 사진이 들어 있는 자리를 프로필에서 지우면 그 사진이 갈 곳이 없다."""
    slots = set(profile.slot_labels())
    if missing := sorted({i.role for i in template.images if i.role != EXTRA_ROLE} - slots):
        raise ValueError(f"사진이 있는 자리를 지울 수 없습니다: {', '.join(missing)} (먼저 템플릿 사진을 바꿔 주세요)")


def add_proposal(template_id: int, profile: ProductProfile, user_id: int, note: str, feedback_ids: list[int]) -> int:
    """AI 개선안을 proposed 버전으로 넣는다 (승인 전까지 쓰이지 않는다). 예전 개선안은 rejected로 정리한다."""
    with session_scope() as db:
        for old in db.scalars(
            select(ProfileVersion).where(ProfileVersion.template_id == template_id, ProfileVersion.status == "proposed")
        ):
            old.status = "rejected"
        last = db.scalar(select(func.max(ProfileVersion.version)).where(ProfileVersion.template_id == template_id)) or 0
        db.add(
            ProfileVersion(
                template_id=template_id, version=last + 1, profile=profile.model_dump_json(), status="proposed",
                source="feedback", note=note, feedback_ids=",".join(map(str, feedback_ids)), created_by=user_id,
            )
        )
        return last + 1


def activate_version(template_id: int, version: int, user_id: int) -> ProfileVersionOut | None:
    """예전 버전으로 되돌리거나(archived) 개선안을 승인한다(proposed). 지금 active는 archived가 된다."""
    with session_scope() as db:
        target = db.scalar(
            select(ProfileVersion).where(ProfileVersion.template_id == template_id, ProfileVersion.version == version)
        )
        template = db.get(Template, template_id)
        if target is None or template is None or target.status in ("active", "rejected"):
            return None
        _check_slots_kept(db, template, ProductProfile.model_validate_json(target.profile))
        if current := active_profile(db, template_id):
            current.status = "archived"
        target.status = "active"
        template.updated_by, template.updated_at = user_id, datetime.now()
    return next(v for v in list_profile_versions(template_id) if v.version == version)


def reject_version(template_id: int, version: int) -> bool:
    with session_scope() as db:
        target = db.scalar(
            select(ProfileVersion).where(
                ProfileVersion.template_id == template_id,
                ProfileVersion.version == version,
                ProfileVersion.status == "proposed",
            )
        )
        if target is None:
            return False
        target.status = "rejected"
        return True
