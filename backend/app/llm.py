from functools import lru_cache

from langchain_openai import ChatOpenAI

from app.config import settings


@lru_cache
def get_chat_model() -> ChatOpenAI:
    """OpenAI 호환 서버(vLLM, Ollama)에 붙는 채팅 모델. 모델 교체는 .env만 바꾸면 된다."""
    extra_body = None
    if settings.llm_disable_thinking:
        # Qwen3의 생각 모드를 끈다 (vLLM chat template 옵션). 다른 모델에서는 무시된다.
        extra_body = {"chat_template_kwargs": {"enable_thinking": False}}
    return ChatOpenAI(
        base_url=settings.llm_base_url,
        api_key="EMPTY",  # 자체 서버는 키를 검사하지 않는다
        model=settings.llm_model,
        temperature=settings.llm_temperature,
        timeout=120,
        extra_body=extra_body,
    )
