import re
import shutil
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select

from app.config import settings
from app.core.db import Run, session_scope
from app.core.domain import PRODUCT_IMAGE_LABELS
from app.core.state import RunInput, RunState

_RUN_ID = re.compile(r"^[\w-]+$")
UPLOAD_NAME = re.compile(r"^[0-9a-f]{32}\.(png|jpg|jpeg|webp)$")
IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp")
EXTRA_PREFIX = "extra_"  # 실행 폴더의 추가 제품 사진 이름: extra_1.png, extra_2.jpg …


def run_dir(run_id: str) -> Path:
    if not _RUN_ID.match(run_id):
        raise ValueError(f"잘못된 run id: {run_id}")
    return settings.data_dir / run_id


def default_product_image(role: str) -> Path | None:
    return next(
        (path for suffix in IMAGE_SUFFIXES if (path := settings.product_image_dir / f"{role}{suffix}").exists()),
        None,
    )


def product_image_dir(run_id: str) -> Path:
    """이 실행이 쓰는 공식 제품 사진 폴더. 이 기능 전에 만든 실행은 폴더가 없어 기본 사진을 쓴다."""
    folder = run_dir(run_id) / "product"
    return folder if folder.is_dir() else settings.product_image_dir


def _copy_product_images(run_input: RunInput, folder: Path) -> None:
    """입력 화면에서 고른 제품 사진(기본·올린 사진·추가 사진)을 실행 폴더로 복사한다. 지운 자리는 복사하지 않는다.
    나중에 기본 사진을 바꾸거나 올린 사진을 지워도 이 실행의 결과는 그대로 다시 만들 수 있다."""
    def upload(name: str) -> Path:
        if not UPLOAD_NAME.match(name) or not (settings.upload_dir / name).exists():
            raise ValueError(f"올린 제품 사진을 찾을 수 없습니다: {name}")
        return settings.upload_dir / name

    sources: dict[str, Path] = {}
    for role in PRODUCT_IMAGE_LABELS:
        choice = run_input.product_images.get(role, "")  # 없는 자리 = 기본 사진
        if choice is None:
            continue
        if choice:
            sources[role] = upload(choice)
        elif default := default_product_image(role):
            sources[role] = default
    for i, name in enumerate(run_input.extra_product_images, start=1):
        sources[f"{EXTRA_PREFIX}{i}"] = upload(name)
    folder.mkdir(parents=True, exist_ok=True)
    for role, source in sources.items():
        shutil.copyfile(source, folder / f"{role}{source.suffix.lower()}")


def create_run(run_input: RunInput, user_id: int) -> RunState:
    now = datetime.now()
    run = RunState(
        id=f"{now:%Y%m%d-%H%M%S}-{uuid4().hex[:6]}",
        created_at=now,
        updated_at=now,
        input=run_input,
    )
    _copy_product_images(run_input, run_dir(run.id) / "product")
    with session_scope() as db:
        db.add(
            Run(
                id=run.id,
                user_id=user_id,
                template_id=run_input.template_id,
                persona=run_input.persona,
                product_name=run_input.product_name,
                state=run.model_dump_json(),
                created_at=run.created_at,
                updated_at=run.updated_at,
            )
        )
    return run


def save_run(run: RunState) -> None:
    """진행 상태를 DB에 쓴다. 생성 중에도 화면이 주기적으로 읽으므로 한 번의 트랜잭션으로 바꾼다."""
    run.updated_at = datetime.now()
    with session_scope() as db:
        row = db.get(Run, run.id)
        if row is None:
            raise ValueError(f"DB에 없는 실행입니다: {run.id}")
        row.state = run.model_dump_json()
        row.persona = run.input.persona
        row.product_name = run.input.product_name
        row.updated_at = run.updated_at


def load_run(run_id: str, user_id: int | None = None) -> RunState | None:
    """user_id를 주면 그 사용자의 실행일 때만 돌려준다."""
    with session_scope() as db:
        row = db.get(Run, run_id)
        if row is None or (user_id is not None and row.user_id != user_id):
            return None
        return RunState.model_validate_json(row.state)


def list_runs(user_id: int) -> list[RunState]:
    """최근에 고친 순서."""
    with session_scope() as db:
        rows = db.scalars(select(Run).where(Run.user_id == user_id).order_by(Run.updated_at.desc()))
        return [RunState.model_validate_json(row.state) for row in rows]
