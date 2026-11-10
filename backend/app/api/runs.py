import io
import json
import logging
import re
import zipfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field, ValidationError

from app.config import settings
from app.core import guard, store
from app.core.render import build_html_input, render_crm
from app.core.domain import LAYOUT_RATIOS, NO_SAFE_ZONE, PodName
from app.core.state import MAIN_SLOT, STEP_ORDER, Option, RunInput, RunState, SlotState
from app.steps import STEPS, Step
from app.steps.copy import CopyOption, CopyStep
from app.steps.image import ImageOption, ImageStep

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/runs", tags=["runs"])


class GenerateRequest(BaseModel):
    feedback: str | None = Field(None, max_length=500)  # 사람의 수정 요청. 있으면 모든 안에 반영한다


class ReviseRequest(BaseModel):
    slot: str = MAIN_SLOT  # 이미지 단계는 Pod 이름
    index: int  # 고칠 안 번호
    request: str = Field(min_length=1, max_length=500)  # 사람의 수정 요청
    pods: list[PodName] = []  # 카피 단계: 고칠 Pod들 (여러 개 또는 전체)


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
    try:
        return store.create_run(run_input)
    except ValueError as e:  # 올린 제품 사진을 찾을 수 없음
        raise HTTPException(400, str(e)) from e


@router.get("/{run_id}", response_model=RunState)
def get_run(run_id: str) -> RunState:
    return _get_run(run_id)


@router.post("/{run_id}/steps/{step_name}/generate", response_model=RunState)
async def generate_step(
    run_id: str, step_name: str, slot: str | None = None, body: GenerateRequest | None = None
) -> RunState:
    """N안 생성. 재생성도 같은 API. slot을 주면 그 슬롯(예: 이미지 단계의 Pod 하나)만 다시 만든다.
    body.feedback을 주면 사람의 수정 요청을 모든 안에 반영한다."""
    feedback = body.feedback.strip() if body and body.feedback else None
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
        if step_name == "image":
            await _generate_images(step, run, slots, feedback)
            return run
        try:
            generated = await step.generate(run, slots, feedback)
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


async def _generate_images(step: Step, run: RunState, slots: list[str], feedback: str | None) -> None:
    """이미지는 한 장에 수십 초가 걸려서, 한 장씩 끝나는 대로 저장한다. 화면은 생성 중에 실행을 다시 읽어 바로 보여준다.
    모든 안이 실패하면 원래 안으로 되돌린다."""
    state = run.steps["image"]
    backup = {s: state.slots.get(s) for s in slots}, run.html
    for s in slots:
        state.slots[s] = SlotState(pending=settings.num_options)
    run.reset_after("image")
    store.save_run(run)

    def on_option(slot: str, option: Option | None) -> None:
        current = state.slots[slot]
        current.pending -= 1
        if option is not None:
            current.options.append(option)
        store.save_run(run)

    try:
        generated = await step.generate(run, slots, feedback, on_option)
    except Exception as e:
        logger.exception("image 단계 생성 실패")
        previous, run.html = backup
        for s, old in previous.items():
            if old is None:
                state.slots.pop(s, None)
            else:
                state.slots[s] = old
        store.save_run(run)
        raise HTTPException(502, f"'image' 생성에 실패했습니다: {e}") from e
    state.slots.update(generated)
    store.save_run(run)


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

    before = _snapshot(run)
    edited = None
    if body.edited is not None:
        try:
            edited = step.make_edited_option(run, body.slot, slot.options[body.index].angle, body.edited)
        except ValidationError as e:
            raise HTTPException(422, f"수정 내용 형식이 맞지 않습니다: {e}") from e

    slot.selected = body.index
    slot.edited = edited
    _apply_change(run, step_name, before)
    store.save_run(run)
    return run


@router.post("/{run_id}/steps/{step_name}/revise", response_model=RunState)
async def revise_option(run_id: str, step_name: str, body: ReviseRequest) -> RunState:
    """고른 안의 일부를 사람의 요청대로 고친다.
    - 이미지: 그 이미지를 고친 새 안을 슬롯에 추가하고 선택한다 (원래 안은 남는다).
    - 카피: 그 안에서 지정한 Pod들(전체 포함)만 다시 쓰고, 수정본으로 선택한다."""
    step = _get_step(step_name)
    if not isinstance(step, ImageStep | CopyStep):
        raise HTTPException(400, "수정 요청은 카피와 이미지 단계에서만 할 수 있습니다.")
    run = _get_run(run_id)
    slot = run.steps[step_name].slots.get(body.slot)
    if slot is None:
        raise HTTPException(400, f"'{step_name}' 단계에 생성된 '{body.slot}' 슬롯이 없습니다.")
    if not 0 <= body.index < len(slot.options):
        raise HTTPException(400, f"고칠 수 있는 안은 0~{len(slot.options) - 1}번입니다.")
    request = body.request.strip()

    guard.check_generate_rate()
    if isinstance(step, ImageStep):
        guard.check_image_budget(1)

    with guard.run_lock(run_id):
        before = _snapshot(run)
        try:
            if isinstance(step, ImageStep):
                base = slot.options[body.index]
                revised = await step.revise_option(run, body.slot, ImageOption.model_validate(base.content), request)
                slot.options.append(step.make_option(run, body.slot, f"{body.index + 1}번 수정 · {request}", revised))
                slot.selected, slot.edited = len(slot.options) - 1, None
            else:
                if not body.pods:
                    raise HTTPException(400, "카피 수정 요청에는 고칠 Pod(pods)가 필요합니다.")
                # 이미 직접 고친 수정본이 있으면 그 위에 고친다
                base = slot.edited if slot.selected == body.index and slot.edited else slot.options[body.index]
                copy = CopyOption.model_validate(base.content)
                unknown = set(body.pods) - {p.pod for p in copy.pods}
                if unknown:
                    raise HTTPException(400, f"이 카피안에 없는 Pod입니다: {', '.join(sorted(unknown))}")
                revised = await step.revise_pods(run, copy, body.pods, request)
                slot.selected, slot.edited = body.index, step.make_option(run, body.slot, base.angle, revised)
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("%s 수정 요청 실패", step_name)
            raise HTTPException(502, f"수정 요청 처리에 실패했습니다: {e}") from e

        _apply_change(run, step_name, before)
        store.save_run(run)
    return run


def _snapshot(run: RunState) -> dict[str, dict[str, str]]:
    """뒤 단계(이미지)에 영향을 주는 앞 단계 선택 값을 Pod별로 모은다. 바뀌기 전후를 비교하는 데 쓴다."""
    snapshot: dict[str, dict[str, str]] = {}
    if run.is_complete("copy"):
        for p in run.selected("copy")["pods"]:
            snapshot[p["pod"]] = {"headline": p["headline"], "body": p["body"]}
    return snapshot


def _apply_change(run: RunState, step_name: str, before: dict[str, dict[str, str]]) -> None:
    """선택·직접 수정·수정 요청 뒤에 부른다. 이미 만든 뒤 단계 결과는 지우지 않고 바뀐 내용만 반영한다.
    - ① Pod 순서가 바뀌면 ② 카피안의 Pod 순서를 따라 맞춘다 (카피 내용은 그대로).
    - ③ 이미지는 그대로 두고, 그 Pod의 카피가 바뀌었거나 바뀐 레이아웃에 화면비가 맞지 않으면 표시만 한다.
    - ④ 시안을 이미 조립했다면 바로 다시 조립한다.
    앞 단계를 다시 '생성'하면 고를 안이 새로 바뀌므로 그때는 generate_step이 뒤 단계를 비운다."""
    if step_name == "pod" and run.is_complete("pod"):
        _follow_pod_order(run)

    after = _snapshot(run)
    plan = {item["pod"]: item["layout"] for item in run.selected("pod")["items"]} if run.is_complete("pod") else {}
    for pod, slot in run.steps["image"].slots.items():
        notes = [n for n in slot.stale if not n.startswith("레이아웃")]  # 레이아웃 표시는 매번 새로 판단한다
        if pod in before and pod in after and before[pod] != after[pod] and COPY_CHANGED not in notes:
            notes.append(COPY_CHANGED)
        option = slot.selected_option or (slot.options[0] if slot.options else None)
        layout = plan.get(pod)
        if option and layout:
            brief = option.content["brief"]
            if brief["ratio"] not in LAYOUT_RATIOS[layout]:
                notes.append(f"레이아웃이 {layout}로 바뀌어 이미지 화면비({brief['ratio']})가 맞지 않습니다")
            elif layout == "L3" and brief["safe_zone"] == NO_SAFE_ZONE:
                notes.append("레이아웃이 L3로 바뀌었지만 이 이미지에는 글자를 얹을 빈 자리(Safe Zone)가 없습니다")
        slot.stale = notes

    if run.html is not None:
        if all(run.is_complete(name) for name in STEP_ORDER):
            _render(run)
        else:
            run.html = None


COPY_CHANGED = "이미지를 만든 뒤 이 Pod의 카피가 바뀌었습니다"


def _follow_pod_order(run: RunState) -> None:
    """②의 모든 카피안을 ①에서 고른 Pod 순서로 다시 늘어놓고 규칙 검사를 다시 한다."""
    slot = run.steps["copy"].slots.get(MAIN_SLOT)
    if slot is None:
        return
    order = [item["pod"] for item in run.selected("pod")["items"]]
    rank = {pod: i for i, pod in enumerate(order)}
    step = STEPS["copy"]
    for option in [*slot.options, *([slot.edited] if slot.edited else [])]:
        pods = sorted(option.content["pods"], key=lambda p: rank.get(p["pod"], len(order)))
        copy = CopyOption.model_validate({**option.content, "pods": pods})
        option.warnings = step.postprocess(run, MAIN_SLOT, copy)
        option.content = copy.model_dump()


def _render(run: RunState) -> None:
    html_input = build_html_input(run)
    run.html = render_crm(run, html_input)
    # 원본 P1 [8]과 같은 모양의 HTML 합성용 JSON도 남긴다
    (store.run_dir(run.id) / "html_input.json").write_text(
        json.dumps(html_input, ensure_ascii=False, indent=2), encoding="utf-8"
    )


@router.post("/{run_id}/steps/image/slots/{slot}/keep", response_model=RunState)
def keep_image(run_id: str, slot: str) -> RunState:
    """앞 단계가 바뀌었다는 표시를 지운다. 사람이 지금 이미지를 그대로 쓰기로 한 경우."""
    run = _get_run(run_id)
    state = run.steps["image"].slots.get(slot)
    if state is None:
        raise HTTPException(400, f"이미지 단계에 생성된 '{slot}' 슬롯이 없습니다.")
    state.stale = []
    store.save_run(run)
    return run


@router.post("/{run_id}/render", response_model=RunState)
def render(run_id: str) -> RunState:
    run = _get_run(run_id)
    missing = [name for name in STEP_ORDER if not run.is_complete(name)]
    if missing:
        raise HTTPException(400, f"아직 선택하지 않은 단계가 있습니다: {', '.join(missing)}")
    _render(run)
    store.save_run(run)
    return run


@router.get("/{run_id}/preview", response_class=HTMLResponse)
def preview(run_id: str) -> str:
    run = _get_run(run_id)
    if run.html is None:
        raise HTTPException(404, "아직 조립된 시안이 없습니다.")
    # 배포 경로 아래에서 열리면 시안 안의 이미지·폰트 주소(/api/...)에도 경로를 붙인다
    base = settings.base_path.rstrip("/")
    return run.html.replace("/api/", f"{base}/api/") if base else run.html


_FONTS_DIR = Path(__file__).resolve().parents[2] / "assets" / "fonts"


@router.get("/{run_id}/download")
def download(run_id: str) -> Response:
    """최종 시안을 ZIP으로 내려받는다. 서버 없이 열리도록 이미지·폰트 주소를 ZIP 안의 상대 경로로 바꾼다."""
    run = _get_run(run_id)
    if run.html is None:
        raise HTTPException(404, "아직 조립된 시안이 없습니다.")
    folder = store.run_dir(run.id)
    html = run.html.replace(f"/api/files/{run.id}/images/", "images/").replace("/api/assets/fonts/", "fonts/")

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("index.html", html)
        for name in sorted(set(re.findall(r'src="images/([^"]+)"', html))):
            zf.write(folder / "images" / name, f"images/{name}")
        for name in sorted(set(re.findall(r"url\('fonts/([^']+)'\)", html))):
            if (_FONTS_DIR / name).exists():  # 폰트 파일을 지운 환경도 있다
                zf.write(_FONTS_DIR / name, f"fonts/{name}")
        if (folder / "html_input.json").exists():
            zf.write(folder / "html_input.json", "html_input.json")
    return Response(
        buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="crm-{run.id}.zip"'},
    )
