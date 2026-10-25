import re
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from app.config import settings
from app.core.state import RunInput, RunState

_RUN_ID = re.compile(r"^[\w-]+$")


def run_dir(run_id: str) -> Path:
    if not _RUN_ID.match(run_id):
        raise ValueError(f"잘못된 run id: {run_id}")
    return settings.data_dir / run_id


def create_run(run_input: RunInput) -> RunState:
    now = datetime.now()
    run = RunState(
        id=f"{now:%Y%m%d-%H%M%S}-{uuid4().hex[:6]}",
        created_at=now,
        updated_at=now,
        input=run_input,
    )
    save_run(run)
    return run


def save_run(run: RunState) -> None:
    run.updated_at = datetime.now()
    path = run_dir(run.id)
    path.mkdir(parents=True, exist_ok=True)
    (path / "state.json").write_text(run.model_dump_json(indent=2), encoding="utf-8")


def load_run(run_id: str) -> RunState | None:
    try:
        path = run_dir(run_id) / "state.json"
    except ValueError:
        return None
    if not path.exists():
        return None
    return RunState.model_validate_json(path.read_text(encoding="utf-8"))
