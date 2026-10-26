import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ValidationError

from app.config import settings
from app.core import guard, store
from app.core.render import build_html_input, render_crm
from app.core.state import MAIN_SLOT, STEP_ORDER, RunInput, RunState
from app.steps import STEPS, Step

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/runs", tags=["runs"])


class SelectRequest(BaseModel):
    slot: str = MAIN_SLOT  # 이미지 단계는 Pod 이름
    index: int
    edited: dict[str, Any] | None = None


def _get_run(run_id: str) -> RunState:
    run = store.load_run(run_id)
    if run is None:
        raise HTTPException(404, f"실행을 찾을 수 없습니다: {run_id}")
    return run


def _get_step(step_name: str) -> Step:
    if step_name not in STEPS:
        raise HTTPException(404, f"알 수 없는 단계입니다: {step_name} (가능: {', '.join(STEP_ORDER)})")
    return STEPS[step_name]


@router.post("", response_model=RunState)
def create_run(run_input: RunInput) -> RunState:
    return store.create_run(run_input)


@router.get("/{run_id}", response_model=RunState)
def get_run(run_id: str) -> RunState:
    return _get_run(run_id)


@router.post("/{run_id}/steps/{step_name}/generate", response_model=RunState)
async def generate_step(run_id: str, step_name: str, slot: str | None = None) -> RunState:
    """N안 생성. 재생성도 같은 API. slot을 주면 그 슬롯(예: 이미지 단계의 Pod 하나)만 다시 만든다."""
    step = _get_step(step_name)
    run = _get_run(run_id)

    previous = run.previous_step(step_name)
    if previous and not run.is_complete(previous):
        raise HTTPException(400, f"먼저 '{previous}' 단계에서 안을 선택해야 합니다.")

    all_slots = step.slots(run)
    if slot is not None and slot not in all_slots:
        raise HTTPException(400, f"'{step_name}' 단계에 없는 슬롯입니다: {slot} (가능: {', '.join(all_slots)})")

    slots = [slot] if slot else all_slots
    guard.check_generate_rate()
    if step_name == "image":
        guard.check_image_budget(len(slots) * settings.num_options)

    with guard.run_lock(run_id):
        try:
            generated = await step.generate(run, slots)
        except Exception as e:
            logger.exception("%s 단계 생성 실패", step_name)
            raise HTTPException(502, f"'{step_name}' 생성에 실패했습니다: {e}") from e

        state = run.steps[step_name]
        if slot is None:
            state.slots = generated
        else:
            state.slots[slot] = generated[slot]
        run.reset_after(step_name)
        store.save_run(run)
    return run


@router.post("/{run_id}/steps/{step_name}/select", response_model=RunState)
def select_option(run_id: str, step_name: str, body: SelectRequest) -> RunState:
    """안 하나를 선택한다. edited를 주면 그 안을 고친 내용으로 저장한다 (같은 스키마·규칙으로 검사)."""
    step = _get_step(step_name)
    run = _get_run(run_id)
    slot = run.steps[step_name].slots.get(body.slot)
    if slot is None:
        raise HTTPException(400, f"'{step_name}' 단계에 생성된 '{body.slot}' 슬롯이 없습니다.")

    if not 0 <= body.index < len(slot.options):
        raise HTTPException(400, f"선택할 수 있는 안은 0~{len(slot.options) - 1}번입니다.")

    edited = None
    if body.edited is not None:
        try:
            edited = step.make_edited_option(run, body.slot, slot.options[body.index].angle, body.edited)
        except ValidationError as e:
            raise HTTPException(422, f"수정 내용 형식이 맞지 않습니다: {e}") from e

    slot.selected = body.index
    slot.edited = edited
    run.reset_after(step_name)
    store.save_run(run)
    return run


@router.post("/{run_id}/render", response_model=RunState)
def render(run_id: str) -> RunState:
    run = _get_run(run_id)
    missing = [name for name in STEP_ORDER if not run.is_complete(name)]
    if missing:
        raise HTTPException(400, f"아직 선택하지 않은 단계가 있습니다: {', '.join(missing)}")

    html_input = build_html_input(run)
    run.html = render_crm(run, html_input)
    # 원본 P1 [8]과 같은 모양의 HTML 합성용 JSON도 남긴다
    (store.run_dir(run.id) / "html_input.json").write_text(
        json.dumps(html_input, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    store.save_run(run)
    return run


@router.get("/{run_id}/preview", response_class=HTMLResponse)
def preview(run_id: str) -> str:
    run = _get_run(run_id)
    if run.html is None:
        raise HTTPException(404, "아직 조립된 시안이 없습니다.")
    return run.html
