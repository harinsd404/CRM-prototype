"""생성 요청 폭주 방지: 연타·여러 탭·반복 호출(루프)·비용 누적을 서버에서 막는다.

화면의 버튼 잠금은 새로고침, 다른 탭, 스크립트에는 효과가 없어서 서버에도 둔다.
"""

import json
import time
from collections import deque
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date
from pathlib import Path

from fastapi import HTTPException

from app.config import settings

_busy_runs: set[str] = set()
_generate_times: deque[float] = deque()


@contextmanager
def run_lock(run_id: str) -> Iterator[None]:
    """한 실행에서는 생성을 한 번에 하나만. 동시에 두 개가 돌면 호출이 두 배가 되고 진행 상태도 서로 덮어쓴다."""
    if run_id in _busy_runs:
        raise HTTPException(409, "이 실행은 이미 생성 중입니다. 끝난 뒤 다시 시도해 주세요.")
    _busy_runs.add(run_id)
    try:
        yield
    finally:
        _busy_runs.discard(run_id)


def check_generate_rate() -> None:
    """최근 1분 동안의 생성 요청 수를 센다. 반복 호출 버그나 스크립트 루프를 끊기 위한 상한."""
    now = time.monotonic()
    while _generate_times and now - _generate_times[0] > 60:
        _generate_times.popleft()
    if len(_generate_times) >= settings.generate_limit_per_minute:
        wait = int(60 - (now - _generate_times[0])) + 1
        raise HTTPException(
            429, f"생성 요청이 너무 많습니다 (1분에 {settings.generate_limit_per_minute}회). {wait}초 뒤 다시 시도해 주세요."
        )
    _generate_times.append(now)


# 하루 이미지 사용량은 서버를 다시 켜도 유지되도록 파일에 둔다 (data/usage.json)
def _usage_path() -> Path:
    return settings.data_dir.parent / "usage.json"


def images_used_today() -> int:
    try:
        usage = json.loads(_usage_path().read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return 0
    return usage["images"] if usage.get("date") == date.today().isoformat() else 0


def check_image_budget(needed: int) -> None:
    """이번 요청에 필요한 장 수가 오늘 남은 한도 안인지 생성 전에 확인한다 (비용이 드는 vertex만)."""
    if settings.image_provider != "vertex":
        return
    used = images_used_today()
    if used + needed > settings.image_daily_limit:
        raise HTTPException(
            429,
            f"오늘 이미지 생성 한도를 넘습니다 (사용 {used}장 + 이번 {needed}장 > 한도 {settings.image_daily_limit}장). "
            "IMAGE_PROVIDER=pool로 미리 저장한 이미지를 쓰거나 IMAGE_DAILY_LIMIT을 조정해 주세요.",
        )


def count_image_call() -> None:
    """이미지 모델이 응답한 호출마다 센다 (다시 생성·재시도도 포함, 429 거절은 제외)."""
    path = _usage_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    usage = {"date": date.today().isoformat(), "images": images_used_today() + 1}
    path.write_text(json.dumps(usage), encoding="utf-8")
