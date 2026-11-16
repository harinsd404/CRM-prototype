"""쌓인 피드백으로 제품 프로필 개선안을 AI가 만든다. 사람이 승인해야 쓰인다 (templates.activate_version)."""

import asyncio
import logging

from pydantic import BaseModel, Field

from app.config import settings
from app.core.feedback import SOURCE_LABELS, STEP_LABELS, FeedbackOut
from app.core.profile import ProductProfile
from app.core.prompts import load_prompt
from app.llm import get_chat_model

logger = logging.getLogger(__name__)

MAX_FEEDBACK = 60  # 한 번에 보내는 피드백 수 (최근 것부터)
_CONTEXT_CHARS = 300
_ATTEMPTS = 3


class ProfileChange(BaseModel):
    field: str = Field(description="바꾼 항목. 예: copy_guide, states.closed_back.rules")
    summary: str = Field(description="무엇을 왜 바꿨는지 한국어 한 줄")


class Unaddressed(BaseModel):
    id: int
    reason: str = Field(description="프로필로 고칠 수 없는 이유 (한국어)")


class ProposalDraft(BaseModel):
    profile: ProductProfile
    changes: list[ProfileChange]
    addressed_feedback: list[int]
    unaddressed: list[Unaddressed] = []


def _format_feedback(items: list[FeedbackOut]) -> str:
    lines = []
    for f in items:
        where = STEP_LABELS[f.step] + (f" · {f.pod}" if f.pod else "")
        lines.append(f"- #{f.id} [{where} · {SOURCE_LABELS[f.source]}] {f.content}")
        if f.context:
            context = f.context.replace("\n", " / ")[:_CONTEXT_CHARS]
            lines.append(f"  당시 결과: {context}")
    return "\n".join(lines)


def _check(current: ProductProfile, draft: ProposalDraft, ids: set[int]) -> None:
    if set(draft.profile.slot_labels()) != set(current.slot_labels()):
        raise ValueError("사진 자리(photo_slots의 key)를 바꿨습니다.")
    before, after = current.model_dump(), draft.profile.model_dump()
    changed = {key for key in before if before[key] != after[key]}
    if not changed:
        raise ValueError("바뀐 곳이 없습니다.")
    # 설명과 실제가 다르면(바꿨다고 했는데 그대로) 다시 생성한다. 설명 없이 바뀐 항목은 설명에 덧붙인다 (실측: 가끔 빠뜨림)
    claimed = {c.field.split(".")[0] for c in draft.changes}
    if missing := claimed - changed:
        raise ValueError(f"바꿨다고 했지만 그대로인 항목: {', '.join(sorted(missing))}")
    draft.changes += [ProfileChange(field=key, summary="(설명 없이 바뀜)") for key in sorted(changed - claimed)]
    draft.addressed_feedback = [i for i in draft.addressed_feedback if i in ids]
    draft.unaddressed = [u for u in draft.unaddressed if u.id in ids]


def note_text(draft: ProposalDraft) -> str:
    """버전 목록에 보여 줄 설명."""
    lines = ["바꾼 점:", *(f"- {c.field}: {c.summary}" for c in draft.changes)]
    if draft.unaddressed:
        lines += ["", "프로필로 고칠 수 없는 피드백 (개발자 확인):", *(f"- #{u.id}: {u.reason}" for u in draft.unaddressed)]
    return "\n".join(lines)


def _mock(current: ProductProfile, items: list[FeedbackOut]) -> ProposalDraft:
    summary = "; ".join(f.content for f in items[:3])
    guide = f"{current.copy_guide}\n- [예시] 피드백 반영: {summary}".strip()
    return ProposalDraft(
        profile=current.model_copy(update={"copy_guide": guide}),
        changes=[ProfileChange(field="copy_guide", summary="[예시] mock 모드: 피드백 내용을 카피 가이드에 붙였습니다.")],
        addressed_feedback=[f.id for f in items],
    )


async def propose(current: ProductProfile, items: list[FeedbackOut]) -> ProposalDraft:
    items = items[:MAX_FEEDBACK]
    if settings.llm_provider == "mock":
        return _mock(current, items)
    ids = {f.id for f in items}
    chain = load_prompt("improve") | get_chat_model().with_structured_output(ProposalDraft, method="json_schema")
    variables = {"profile": current.model_dump_json(indent=1), "feedback": _format_feedback(items), "count": str(len(items))}
    error: Exception | None = None
    for attempt in range(1, _ATTEMPTS + 1):
        try:
            draft = await asyncio.wait_for(chain.ainvoke(variables), settings.llm_timeout * 3)
            _check(current, draft, ids)
            return draft
        except Exception as e:
            error = e
            logger.warning("프로필 개선안 생성 실패 (%d/%d)", attempt, _ATTEMPTS, exc_info=True)
    raise RuntimeError(f"개선안을 만들지 못했습니다: {error}")
