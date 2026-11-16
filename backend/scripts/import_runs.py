"""DB 도입 전에 data/runs/{run_id}/state.json으로 저장된 실행을 DB로 가져와 한 사용자에게 붙인다.
이미 DB에 있는 실행은 건너뛴다. state.json 파일은 지우지 않는다.

    uv run python scripts/import_runs.py <아이디>
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.config import settings  # noqa: E402
from app.core.db import Run, User, init_db, session_scope  # noqa: E402
from app.core.state import RunState  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    init_db()
    imported = skipped = failed = 0
    with session_scope() as db:
        user = db.scalar(select(User).where(User.username == sys.argv[1]))
        if user is None:
            sys.exit(f"계정이 없습니다: {sys.argv[1]} (먼저 scripts/add_user.py로 만드세요)")
        for path in sorted(settings.data_dir.glob("*/state.json")):
            if db.get(Run, path.parent.name):
                skipped += 1
                continue
            try:
                run = RunState.model_validate_json(path.read_text(encoding="utf-8"))
            except ValueError as e:  # 예전 형식이라 지금 스키마와 맞지 않음
                print(f"건너뜀 {path.parent.name}: {str(e).splitlines()[0]}")
                failed += 1
                continue
            db.add(
                Run(
                    id=run.id,
                    user_id=user.id,
                    persona=run.input.persona,
                    product_name=run.input.product_name,
                    state=run.model_dump_json(),
                    created_at=run.created_at,
                    updated_at=run.updated_at,
                )
            )
            imported += 1
    print(f"가져옴 {imported} · 이미 있음 {skipped} · 형식이 달라 못 가져옴 {failed}")


if __name__ == "__main__":
    main()
