import io
import json
import logging
import re
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field, ValidationError

from app.api.auth import CurrentUser
from app.config import settings
from app.core import guard, store
from app.core.db import User
from app.core.render import build_html_input, render_crm
from app.core.domain import LAYOUT_RATIOS, NO_SAFE_ZONE
from app.core import templates
from app.core.feedback import FeedbackIn, add_feedback
from app.core.templates import ProfileConflict, TemplateNameTaken, TemplateOut, get_template
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
    pods: list[str] = []  # 카피 단계: 고칠 Pod들 (여러 개 또는 전체)


class SelectRequest(BaseModel):
    slot: str = MAIN_SLOT  # 이미지 단계는 Pod 이름
    index: int
    edited: dict[str, Any] | None = None


def _get_run(run_id: str, user: User) -> RunState:
    """다른 사용자의 실행은 없는 것으로 본다."""
    run = store.load_run(run_id, user.id)
    if run is None:
        raise HTTPException(404, f"실행을 찾을 수 없습니다: {run_id}")
    return run


def _log_request(run: RunState, user: User, step: str, pod: str | None, text: str, source: str) -> None:
    """다시 생성·수정 요청도 '마음에 들지 않는 부분'이라 템플릿별 피드백으로 쌓는다. 실패해도 생성은 계속한다."""
    try:
        add_feedback(run, user.id, FeedbackIn(step=step, pod=pod, content=text[:1000]), source=source)
    except Exception:
        logger.warning("요청을 피드백으로 저장하지 못했습니다", exc_info=True)


def _get_step(step_name: str) -> Step:
    if step_name not in STEPS:
        raise HTTPException(404, f"알 수 없는 단계입니다: {step_name} (가능: {', '.join(STEP_ORDER)})")
    return STEPS[step_name]


class RunSummary(BaseModel):
    """내 작업 목록의 한 줄."""

    id: str
    created_at: datetime
    updated_at: datetime
    target_id: str
    persona: str
    mood: str
    product_name: str
    completed_steps: list[str]  # 선택까지 끝낸 단계
    has_html: bool  # ④ 시안을 조립했는지
    input: RunInput  # "이 입력으로 새로 만들기"에 쓴다


@router.get("", response_model=list[RunSummary])
def list_runs(user: CurrentUser) -> list[RunSummary]:
    return [
        RunSummary(
            id=run.id,
            created_at=run.created_at,
            updated_at=run.updated_at,
            target_id=run.input.target_id,
            persona=run.input.persona,
            mood=run.input.mood,
            product_name=run.input.product_name,
            completed_steps=[name for name in STEP_ORDER if _is_complete(run, name)],
            has_html=run.html is not None,
            input=run.input,
        )
        for run in store.list_runs(user.id)
    ]


def _is_complete(run: RunState, step_name: str) -> bool:
    previous = run.previous_step(step_name)
    return (previous is None or _is_complete(run, previous)) and run.is_complete(step_name)


class SaveTemplateRequest(BaseModel):
    template_id: int | None = None  # 있으면 그 템플릿을 덮어쓴다
    name: str | None = Field(None, max_length=100)  # 새 템플릿 이름 (덮어쓸 때 주면 이름도 바꾼다)


def _started_version(run: RunState, base: TemplateOut) -> int | None:
    """이 실행이 시작할 때 쓴 base 템플릿의 프로필 버전 (다른 템플릿에서 시작했거나 기록이 없으면 None = 검사 안 함)."""
    return run.input.profile_version if run.input.template_id == base.id else None


@router.post("/{run_id}/template", response_model=TemplateOut)
def save_as_template(run_id: str, body: SaveTemplateRequest, user: CurrentUser) -> TemplateOut:
    """이 실행의 제품명·컬러·Pod·제품 사진을 템플릿으로 저장한다 (새로 만들기 또는 덮어쓰기)."""
    run = _get_run(run_id, user)
    base = None
    if body.template_id is not None:
        base = get_template(body.template_id)
        if base is None:
            raise HTTPException(404, f"템플릿을 찾을 수 없습니다: {body.template_id}")
    name = (body.name or "").strip() or (base.name if base else "")
    if not name:
        raise HTTPException(400, "새 템플릿 이름을 적어 주세요.")
    try:
        # 사진을 복사하기 전에 이름부터 확인한다 (겹치면 복사한 사진이 쓸모없이 남는다)
        templates.check_name_free(name, exclude_id=base.id if base else None)
        data = templates.template_data_from_run(run, name, base)
        if base is None:
            saved = templates.create_template(data, user.id, source="run")
        else:
            base_version = _started_version(run, base)
            if base_version is not None and base_version != base.profile_version:
                # 실행을 시작한 뒤 템플릿 규칙이 바뀌었다. 이 실행에서 규칙을 고치지 않았으면 새 규칙을 그대로 둔다
                if run.input.product_profile == templates.profile_at(base.id, base_version):
                    data.profile = None
            saved = templates.update_template(base.id, data, user.id, source="run", base_version=base_version)
            assert saved is not None
    except TemplateNameTaken as e:
        raise HTTPException(409, str(e)) from e
    except ProfileConflict as e:
        raise HTTPException(
            409, f"{e} 이 실행에서 고친 규칙으로 덮어쓰면 그 내용이 사라집니다. 새 템플릿으로 저장해 주세요."
        ) from e
    # 다음에 이 실행으로 "다른 페르소나로"를 만들면 저장한 템플릿을 불러오게 한다.
    # 이 실행의 규칙이 템플릿에 들어갔으면 다시 저장할 때의 기준 버전도 맞춘다 (새 규칙을 그대로 뒀으면 예전 기준을 남겨 둔다)
    version = saved.profile_version if saved.profile == run.input.product_profile else run.input.profile_version
    if (run.input.template_id, run.input.profile_version) != (saved.id, version):

        def apply(fresh: RunState) -> None:
            fresh.input.template_id, fresh.input.profile_version = saved.id, version

        store.mutate_run(run_id, apply)
    return saved


@router.post("", response_model=RunState)
def create_run(run_input: RunInput, user: CurrentUser) -> RunState:
    if run_input.template_id is not None and get_template(run_input.template_id) is None:
        run_input.template_id = None  # 그 사이 지워진 템플릿
    try:
        return store.create_run(run_input, user.id)
    except ValueError as e:  # 올린 제품 사진을 찾을 수 없음
        raise HTTPException(400, str(e)) from e


@router.get("/{run_id}", response_model=RunState)
def get_run(run_id: str, user: CurrentUser) -> RunState:
    return _get_run(run_id, user)


@router.post("/{run_id}/steps/{step_name}/generate", response_model=RunState)
async def generate_step(
    run_id: str, step_name: str, user: CurrentUser, slot: str | None = None, body: GenerateRequest | None = None
) -> RunState:
    """N안 생성. 재생성도 같은 API. slot을 주면 그 슬롯(예: 이미지 단계의 Pod 하나)만 다시 만든다.
    body.feedback을 주면 사람의 수정 요청을 모든 안에 반영한다."""
    feedback = body.feedback.strip() if body and body.feedback else None
    step = _get_step(step_name)
    run = _get_run(run_id, user)

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
    if feedback:  # 다시 만들기 전 결과에 대한 요청이라 생성 전에 남긴다
        _log_request(run, user, step_name, slot, feedback, "regenerate")

    with guard.run_lock(run_id):
        if step_name == "image":
            return await _generate_images(step, run, slots, feedback)
        try:
            generated = await step.generate(run, slots, feedback)
        except Exception as e:
            logger.exception("%s 단계 생성 실패", step_name)
            raise HTTPException(502, f"'{step_name}' 생성에 실패했습니다: {e}") from e

        def apply(fresh: RunState) -> None:
            state = fresh.steps[step_name]
            if slot is None:
                state.slots = generated
            else:
                state.slots[slot] = generated[slot]
            fresh.reset_after(step_name)

        return store.mutate_run(run_id, apply)


async def _generate_images(step: Step, run: RunState, slots: list[str], feedback: str | None) -> RunState:
    """이미지는 한 장에 수십 초가 걸려서, 한 장씩 끝나는 대로 저장한다. 화면은 생성 중에 실행을 다시 읽어 바로 보여준다.
    생성 중에도 사람이 다른 Pod(또는 먼저 나온 이미지)를 고를 수 있으므로, 저장할 때마다 최신 상태에 이 생성의 변경만 얹는다.
    모든 안이 실패하면 원래 안으로 되돌린다."""
    backup: dict[str, SlotState | None] = {}
    html_backup: list[str | None] = [None]

    def start(fresh: RunState) -> None:
        state = fresh.steps["image"]
        backup.update({s: state.slots.get(s) for s in slots})
        html_backup[0] = fresh.html
        for s in slots:
            state.slots[s] = SlotState(pending=settings.num_options)
        fresh.reset_after("image")

    store.mutate_run(run.id, start)

    def on_option(slot: str, option: Option | None, failure: str | None) -> None:
        def add(fresh: RunState) -> None:
            current = fresh.steps["image"].slots.get(slot)
            if current is None:
                return
            current.pending = max(0, current.pending - 1)
            if option is not None:
                current.options.append(option)
            if failure:
                current.failures.append(failure)

        store.mutate_run(run.id, add)

    try:
        await step.generate(run, slots, feedback, on_option)
    except Exception as e:
        logger.exception("image 단계 생성 실패")

        def restore(fresh: RunState) -> None:
            state = fresh.steps["image"]
            fresh.html = html_backup[0]
            for s, old in backup.items():
                if old is None:
                    state.slots.pop(s, None)
                else:
                    state.slots[s] = old

        store.mutate_run(run.id, restore)
        raise HTTPException(502, f"'image' 생성에 실패했습니다: {e}") from e

    # 안은 끝나는 대로 이미 붙었다 (collect_options가 돌려주는 순서와 같다). 남은 표시만 정리한다
    def finish(fresh: RunState) -> None:
        for s in slots:
            if current := fresh.steps["image"].slots.get(s):
                current.pending = 0

    return store.mutate_run(run.id, finish)


@router.post("/{run_id}/steps/{step_name}/select", response_model=RunState)
def select_option(run_id: str, step_name: str, body: SelectRequest, user: CurrentUser) -> RunState:
    """안 하나를 선택한다. edited를 주면 그 안을 고친 내용으로 저장한다 (같은 스키마·규칙으로 검사)."""
    step = _get_step(step_name)
    _get_run(run_id, user)  # 권한 확인

    def apply(run: RunState) -> None:
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
            except ValueError as e:  # 입력에 없는 Pod 이름 등
                raise HTTPException(422, str(e)) from e

        slot.selected = body.index
        slot.edited = edited
        _apply_change(run, step_name, before)

    return store.mutate_run(run_id, apply)


@router.post("/{run_id}/steps/{step_name}/revise", response_model=RunState)
async def revise_option(run_id: str, step_name: str, body: ReviseRequest, user: CurrentUser) -> RunState:
    """고른 안의 일부를 사람의 요청대로 고친다.
    - 이미지: 그 이미지를 고친 새 안을 슬롯에 추가하고 선택한다 (원래 안은 남는다).
    - 카피: 그 안에서 지정한 Pod들(전체 포함)만 다시 쓰고, 수정본으로 선택한다."""
    step = _get_step(step_name)
    if not isinstance(step, ImageStep | CopyStep):
        raise HTTPException(400, "수정 요청은 카피와 이미지 단계에서만 할 수 있습니다.")
    run = _get_run(run_id, user)
    slot = run.steps[step_name].slots.get(body.slot)
    if slot is None:
        raise HTTPException(400, f"'{step_name}' 단계에 생성된 '{body.slot}' 슬롯이 없습니다.")
    if not 0 <= body.index < len(slot.options):
        raise HTTPException(400, f"고칠 수 있는 안은 0~{len(slot.options) - 1}번입니다.")
    request = body.request.strip()

    guard.check_generate_rate()
    if isinstance(step, ImageStep):
        guard.check_image_budget(1)
    pod = body.slot if isinstance(step, ImageStep) else (body.pods[0] if len(body.pods) == 1 else None)
    _log_request(run, user, step_name, pod, request, "revise")

    with guard.run_lock(run_id):
        if isinstance(step, ImageStep):
            base = slot.options[body.index]
            try:
                revised = await step.revise_option(run, body.slot, ImageOption.model_validate(base.content), request)
            except Exception as e:
                logger.exception("%s 수정 요청 실패", step_name)
                raise HTTPException(502, f"수정 요청 처리에 실패했습니다: {e}") from e
            option = step.make_option(run, body.slot, f"{body.index + 1}번 수정 · {request}", revised)

            def add(fresh: RunState) -> None:
                # 수정하는 동안 다른 Pod를 고르거나 했을 수 있으니 최신 상태에 새 안만 붙이고 고른다
                target = fresh.steps[step_name].slots.get(body.slot)
                if target is None:
                    raise HTTPException(409, f"수정하는 사이 '{body.slot}' 이미지가 다시 생성되었습니다.")
                before = _snapshot(fresh)
                target.options.append(option)
                target.selected, target.edited = len(target.options) - 1, None
                _apply_change(fresh, step_name, before)

            return store.mutate_run(run_id, add)

        if not body.pods:
            raise HTTPException(400, "카피 수정 요청에는 고칠 Pod(pods)가 필요합니다.")
        # 이미 직접 고친 수정본이 있으면 그 위에 고친다
        base = slot.edited if slot.selected == body.index and slot.edited else slot.options[body.index]
        copy = CopyOption.model_validate(base.content)
        unknown = set(body.pods) - {p.pod for p in copy.pods}
        if unknown:
            raise HTTPException(400, f"이 카피안에 없는 Pod입니다: {', '.join(sorted(unknown))}")
        try:
            revised = await step.revise_pods(run, copy, body.pods, request)
        except Exception as e:
            logger.exception("%s 수정 요청 실패", step_name)
            raise HTTPException(502, f"수정 요청 처리에 실패했습니다: {e}") from e
        edited = step.make_option(run, body.slot, base.angle, revised)

        def apply(fresh: RunState) -> None:
            target = fresh.steps[step_name].slots.get(body.slot)
            if target is None or body.index >= len(target.options):
                raise HTTPException(409, "수정하는 사이 카피안이 다시 생성되었습니다.")
            before = _snapshot(fresh)
            target.selected, target.edited = body.index, edited
            _apply_change(fresh, step_name, before)

        return store.mutate_run(run_id, apply)


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
def keep_image(run_id: str, slot: str, user: CurrentUser) -> RunState:
    """앞 단계가 바뀌었다는 표시를 지운다. 사람이 지금 이미지를 그대로 쓰기로 한 경우."""
    _get_run(run_id, user)  # 권한 확인

    def apply(run: RunState) -> None:
        state = run.steps["image"].slots.get(slot)
        if state is None:
            raise HTTPException(400, f"이미지 단계에 생성된 '{slot}' 슬롯이 없습니다.")
        state.stale = []

    return store.mutate_run(run_id, apply)


@router.post("/{run_id}/render", response_model=RunState)
def render(run_id: str, user: CurrentUser) -> RunState:
    _get_run(run_id, user)  # 권한 확인

    def apply(run: RunState) -> None:
        missing = [name for name in STEP_ORDER if not run.is_complete(name)]
        if missing:
            raise HTTPException(400, f"아직 선택하지 않은 단계가 있습니다: {', '.join(missing)}")
        _render(run)

    return store.mutate_run(run_id, apply)


@router.get("/{run_id}/preview", response_class=HTMLResponse)
def preview(run_id: str, user: CurrentUser) -> str:
    run = _get_run(run_id, user)
    if run.html is None:
        raise HTTPException(404, "아직 조립된 시안이 없습니다.")
    # 배포 경로 아래에서 열리면 시안 안의 이미지·폰트 주소(/api/...)에도 경로를 붙인다
    base = settings.base_path.rstrip("/")
    return run.html.replace("/api/", f"{base}/api/") if base else run.html


_FONTS_DIR = Path(__file__).resolve().parents[2] / "assets" / "fonts"


@router.get("/{run_id}/download")
def download(run_id: str, user: CurrentUser) -> Response:
    """최종 시안을 ZIP으로 내려받는다. 서버 없이 열리도록 이미지·폰트 주소를 ZIP 안의 상대 경로로 바꾼다."""
    run = _get_run(run_id, user)
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
