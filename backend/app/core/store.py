import re
import shutil
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from app.config import settings
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


def create_run(run_input: RunInput) -> RunState:
    now = datetime.now()
    run = RunState(
        id=f"{now:%Y%m%d-%H%M%S}-{uuid4().hex[:6]}",
        created_at=now,
        updated_at=now,
        input=run_input,
    )
    _copy_product_images(run_input, run_dir(run.id) / "product")
    save_run(run)
    return run


def save_run(run: RunState) -> None:
    run.updated_at = datetime.now()
    path = run_dir(run.id)
    path.mkdir(parents=True, exist_ok=True)
    # 생성 중에도 화면이 state.json을 읽으므로, 다 쓴 임시 파일로 한 번에 바꿔 반쯤 쓴 파일을 읽지 않게 한다
    tmp = path / "state.json.tmp"
    tmp.write_text(run.model_dump_json(indent=2), encoding="utf-8")
    tmp.replace(path / "state.json")


def load_run(run_id: str) -> RunState | None:
    try:
        path = run_dir(run_id) / "state.json"
    except ValueError:
        return None
    if not path.exists():
        return None
    return RunState.model_validate_json(path.read_text(encoding="utf-8"))
