from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # mock: 모델 없이 고정 예시 / openai: OpenAI 호환 서버(Ollama, vLLM)
    llm_provider: Literal["mock", "openai"] = "mock"
    llm_base_url: str = "http://localhost:11434/v1"
    llm_model: str = "qwen3:8b"
    llm_temperature: float = 0.9
    llm_disable_thinking: bool = True

    image_provider: Literal["placeholder", "pool", "vertex"] = "placeholder"
    image_pool_dir: Path = BACKEND_DIR / "assets" / "image_pool"
    # 공식 제품 사진 (P2의 첨부 ①): closed_front / closed_back / unfolded, 선택: style_anchor (②)
    product_image_dir: Path = BACKEND_DIR / "assets" / "product"

    # Vertex AI Gemini 이미지 (인증: gcloud auth application-default login)
    google_cloud_project: str = ""
    google_cloud_location: str = "global"
    vertex_image_model: str = "gemini-2.5-flash-image"
    image_concurrency: int = 3  # 동시에 보내는 이미지 요청 수 (Vertex 할당량 보호)

    num_options: int = 3
    data_dir: Path = BACKEND_DIR / "data" / "runs"


settings = Settings()
