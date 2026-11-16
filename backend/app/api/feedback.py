import csv
import io

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from app.api.auth import CurrentUser
from app.core import feedback, store
from app.core.feedback import SOURCE_LABELS, STEP_LABELS, FeedbackIn, FeedbackOut, FeedbackStatus

router = APIRouter(tags=["feedback"])


def _run_or_404(run_id: str, user_id: int):
    run = store.load_run(run_id, user_id)
    if run is None:
        raise HTTPException(404, f"실행을 찾을 수 없습니다: {run_id}")
    return run


@router.post("/runs/{run_id}/feedback", response_model=FeedbackOut)
def add_feedback(run_id: str, body: FeedbackIn, user: CurrentUser) -> FeedbackOut:
    """만든 CRM에서 마음에 들지 않는 부분을 남긴다. 실행이 불러온 템플릿의 피드백으로 모인다."""
    run = _run_or_404(run_id, user.id)
    if body.pod is not None and body.pod not in run.input.pod_names:
        raise HTTPException(400, f"이 실행에 없는 Pod입니다: {body.pod}")
    new_id = feedback.add_feedback(run, user.id, body)
    return next(f for f in feedback.list_feedback(user.id, run_id=run_id) if f.id == new_id)


@router.get("/runs/{run_id}/feedback", response_model=list[FeedbackOut])
def run_feedback(run_id: str, user: CurrentUser) -> list[FeedbackOut]:
    _run_or_404(run_id, user.id)
    return feedback.list_feedback(user.id, run_id=run_id)


def _query(user_id: int, template_id: int | None, no_template: bool, status: str | None, source: str | None):
    return feedback.list_feedback(
        user_id, template_id=template_id, no_template=no_template, status=status, source=source
    )


@router.get("/feedback", response_model=list[FeedbackOut])
def list_feedback(
    user: CurrentUser,
    template_id: int | None = None,
    no_template: bool = False,
    status: FeedbackStatus | None = None,
    source: str | None = None,
) -> list[FeedbackOut]:
    """템플릿별 피드백 모아 보기 (모든 사용자). 조건이 없으면 전체."""
    return _query(user.id, template_id, no_template, status, source)


@router.get("/feedback/export")
def export_feedback(
    user: CurrentUser,
    template_id: int | None = None,
    no_template: bool = False,
    status: FeedbackStatus | None = None,
    source: str | None = None,
) -> Response:
    """개발자가 로직 개선에 쓰도록 CSV로 내려받는다 (엑셀에서 한글이 깨지지 않게 BOM을 붙인다)."""
    rows = _query(user.id, template_id, no_template, status, source)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["id", "작성일", "템플릿", "실행", "페르소나", "작성자", "단계", "Pod", "종류", "상태", "피드백", "당시 결과"])
    for f in rows:
        writer.writerow([
            f.id, f.created_at.strftime("%Y-%m-%d %H:%M"), f.template_name or "(템플릿 없음)", f.run_id, f.persona,
            f.username, STEP_LABELS[f.step], f.pod or "", SOURCE_LABELS[f.source], f.status, f.content, f.context,
        ])
    return Response(
        "﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="feedback.csv"'},
    )


class StatusRequest(BaseModel):
    status: FeedbackStatus


@router.patch("/feedback/{feedback_id}", response_model=dict)
def update_status(feedback_id: int, body: StatusRequest, user: CurrentUser) -> dict:
    """반영함(applied) / 보류(dismissed) / 다시 열기(open). 템플릿을 함께 쓰므로 누구나 바꿀 수 있다."""
    if not feedback.set_status(feedback_id, body.status):
        raise HTTPException(404, "피드백을 찾을 수 없습니다.")
    return {"ok": True}


@router.delete("/feedback/{feedback_id}", response_model=dict)
def delete(feedback_id: int, user: CurrentUser) -> dict:
    if not feedback.delete_feedback(feedback_id, user.id):
        raise HTTPException(404, "내가 남긴 피드백만 지울 수 있습니다.")
    return {"ok": True}
