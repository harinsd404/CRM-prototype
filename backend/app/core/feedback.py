"""피드백 저장·조회. 템플릿별로 모은다 (실행이 불러온 템플릿 기준, 없으면 '템플릿 없음')."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.db import Feedback, Run, Template, User, session_scope
from app.core.state import RunState

FeedbackStep = Literal["pod", "copy", "image", "result"]
FeedbackSource = Literal["manual", "regenerate", "revise"]
FeedbackStatus = Literal["open", "applied", "dismissed"]

STEP_LABELS = {"pod": "① Pod 순서", "copy": "② 카피", "image": "③ 이미지", "result": "④ 최종 시안"}
SOURCE_LABELS = {"manual": "직접 남김", "regenerate": "다시 생성 요청", "revise": "수정 요청"}


class FeedbackIn(BaseModel):
    step: FeedbackStep
    pod: str | None = None
    content: str = Field(min_length=1, max_length=1000)


class FeedbackOut(BaseModel):
    id: int
    template_id: int | None
    template_name: str | None
    run_id: str
    persona: str
    username: str
    step: FeedbackStep
    pod: str | None
    content: str
    context: str
    source: FeedbackSource
    status: FeedbackStatus
    created_at: datetime
    mine: bool  # 내가 남긴 피드백 (지울 수 있음)


def build_context(run: RunState, step: str, pod: str | None) -> str:
    """피드백을 남길 때 선택돼 있던 결과를 짧은 글로 남긴다. 나중에 실행이 바뀌어도 무엇에 대한 피드백인지 알 수 있게."""
    lines: list[str] = []
    try:
        if step in ("pod", "result") and run.is_complete("pod"):
            items = run.selected("pod")["items"]
            lines.append("Pod 순서: " + " → ".join(f"{i['pod']}({i['layout']})" for i in items))
        if step in ("copy", "result") and run.is_complete("copy"):
            for p in run.selected("copy")["pods"]:
                if pod is None or p["pod"] == pod:
                    lines.append(f"[{p['pod']}] {p['headline']} / {p['body']}")
        if step in ("image", "result") and run.steps["image"].slots:
            for name, slot in run.steps["image"].slots.items():
                option = slot.selected_option
                if option and (pod is None or name == pod):
                    brief = option.content.get("brief", {})
                    lines.append(f"[{name} 이미지] {brief.get('concept', '')} — {option.content.get('image_url', '')}")
    except (AssertionError, KeyError, StopIteration):
        pass  # 아직 고르지 않은 단계
    return "\n".join(lines)


def add_feedback(
    run: RunState, user_id: int, data: FeedbackIn, source: FeedbackSource = "manual"
) -> int:
    with session_scope() as db:
        feedback = Feedback(
            template_id=run.input.template_id,
            run_id=run.id,
            user_id=user_id,
            step=data.step,
            pod=data.pod,
            content=data.content.strip(),
            context=build_context(run, data.step, data.pod),
            source=source,
        )
        db.add(feedback)
        db.flush()
        return feedback.id


def list_feedback(
    user_id: int,
    *,
    run_id: str | None = None,
    template_id: int | None = None,
    no_template: bool = False,
    status: str | None = None,
    source: str | None = None,
) -> list[FeedbackOut]:
    """최근 순서. 템플릿별 목록은 모든 사용자의 피드백을 보여준다 (템플릿을 함께 쓰므로)."""
    query = (
        select(Feedback, User.username, Template.name, Run.persona)
        .join(User, User.id == Feedback.user_id)
        .join(Run, Run.id == Feedback.run_id)
        .outerjoin(Template, Template.id == Feedback.template_id)
        .order_by(Feedback.created_at.desc())
    )
    if run_id is not None:
        query = query.where(Feedback.run_id == run_id)
    if template_id is not None:
        query = query.where(Feedback.template_id == template_id)
    elif no_template:
        query = query.where(Feedback.template_id.is_(None))
    if status:
        query = query.where(Feedback.status == status)
    if source:
        query = query.where(Feedback.source == source)
    with session_scope() as db:
        return [
            FeedbackOut(
                id=f.id,
                template_id=f.template_id,
                template_name=template_name,
                run_id=f.run_id,
                persona=persona,
                username=username,
                step=f.step,
                pod=f.pod,
                content=f.content,
                context=f.context,
                source=f.source,
                status=f.status,
                created_at=f.created_at,
                mine=f.user_id == user_id,
            )
            for f, username, template_name, persona in db.execute(query).all()
        ]


def set_status(feedback_id: int, status: FeedbackStatus) -> bool:
    with session_scope() as db:
        feedback = db.get(Feedback, feedback_id)
        if feedback is None:
            return False
        feedback.status = status
        return True


def delete_feedback(feedback_id: int, user_id: int) -> bool:
    """자기가 남긴 피드백만 지운다."""
    with session_scope() as db:
        feedback = db.get(Feedback, feedback_id)
        if feedback is None or feedback.user_id != user_id:
            return False
        db.delete(feedback)
        return True
