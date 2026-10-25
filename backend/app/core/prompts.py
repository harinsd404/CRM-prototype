from functools import lru_cache
from pathlib import Path

from langchain_core.prompts import ChatPromptTemplate

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts"
_SYSTEM_HEADING = "## system"
_HUMAN_HEADING = "## human"


@lru_cache
def load_prompt(name: str) -> ChatPromptTemplate:
    """prompts/{name}.md를 읽는다. `## system` 아래는 시스템 메시지, `## human` 아래는 사용자 메시지.

    `## system` 위의 내용(메모, TODO 주석)은 모델에 보내지 않는다.
    본문의 {변수}는 LangChain 템플릿 변수다. 중괄호 글자가 필요하면 {{ }}로 쓴다.
    """
    text = (PROMPT_DIR / f"{name}.md").read_text(encoding="utf-8")
    _, body = text.split(_SYSTEM_HEADING, 1)
    system, human = body.split(_HUMAN_HEADING, 1)
    return ChatPromptTemplate.from_messages([("system", system.strip()), ("human", human.strip())])
