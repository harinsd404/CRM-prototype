"""실행 하나에서 생성된 이미지를 시연 대비용 풀(assets/image_pool)에 저장한다.

    uv run python scripts/save_pool.py <run_id>          # 모든 안
    uv run python scripts/save_pool.py <run_id> --selected  # 선택한 안만

저장 구조: image_pool/{Pod 영문명}/{화면비}_{파일}. IMAGE_PROVIDER=pool이면 같은 Pod·화면비에서 고른다.
"""

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.core.domain import POD_ENGLISH  # noqa: E402
from app.core.store import load_run, run_dir  # noqa: E402
from app.providers.image import pool_ratio_tag  # noqa: E402


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    run_id, selected_only = sys.argv[1], "--selected" in sys.argv[2:]
    run = load_run(run_id)
    saved = 0
    for pod, slot in run.steps["image"].slots.items():
        options = [slot.selected_option] if selected_only else slot.options
        for option in filter(None, options):
            source = run_dir(run.id) / "images" / Path(option.content["image_url"]).name
            folder = settings.image_pool_dir / POD_ENGLISH[pod]
            folder.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, folder / f"{pool_ratio_tag(option.content['brief']['ratio'])}_{source.name}")
            saved += 1
    print(f"{saved}장을 {settings.image_pool_dir}에 저장했습니다.")


if __name__ == "__main__":
    main()
