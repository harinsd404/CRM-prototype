from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # mock: 모델 없이 고정 예시 / vertex: 회사 GCP의 Vertex AI Gemini / openai: OpenAI 호환 서버(Ollama, vLLM)
    llm_provider: Literal["mock", "vertex", "openai"] = "mock"
    llm_base_url: str = "http://localhost:11434/v1"
    llm_model: str = "qwen3:8b"
    llm_temperature: float = 0.9
    llm_disable_thinking: bool = True
    llm_timeout: float = 45  # 응답이 멈추는 경우가 있어 코드에서 직접 끊고 다시 시도한다
    llm_concurrency: int = 6  # 동시에 보내는 텍스트 요청 수 (③은 Pod 5개 × N안)

    image_provider: Literal["placeholder", "pool", "vertex"] = "placeholder"
    image_pool_dir: Path = BACKEND_DIR / "assets" / "image_pool"
    # 공식 제품 사진 (P2의 첨부 ①): closed_front / closed_back / unfolded, 선택: style_anchor (②)
    product_image_dir: Path = BACKEND_DIR / "assets" / "product"

    # Vertex AI Gemini 텍스트·이미지 (인증: gcloud auth application-default login)
    google_cloud_project: str = ""
    google_cloud_location: str = "global"
    vertex_text_model: str = "gemini-3.5-flash"
    vertex_thinking_level: str = "low"  # low면 응답이 약 4배 빠르다 (측정: 12초 → 3초)
    vertex_image_model: str = "gemini-3.1-flash-image"
    # 위 모델이 계속 429(쿼터 소진)면 이 모델로 대신 보낸다. 비우면 대체하지 않는다
    vertex_image_fallback_model: str = "gemini-2.5-flash-image"
    image_fallback_minutes: float = 10  # 대체로 넘어간 뒤 이 시간 동안은 위 모델을 건너뛴다
    image_concurrency: int = 1  # 동시에 보내는 이미지 요청 수. 2 이상이면 429가 잦았다 (실측)
    image_timeout: float = 120

    num_options: int = 3
    # 배포 경로 (예: /park). 프록시가 이 경로를 떼지 않고 넘길 때 앱이 떼고 처리한다. 비우면 / 에서 동작
    base_path: str = ""
    # 폭주 방지 (app/core/guard.py)
    generate_limit_per_minute: int = 10  # 생성 요청 수 상한 (연타·반복 호출 대비)
    image_daily_limit: int = 100  # 하루 Vertex 이미지 호출 상한 (재시도 포함)
    data_dir: Path = BACKEND_DIR / "data" / "runs"  # 실행별 파일 (이미지·제품 사진·html_input.json)
    db_path: Path = BACKEND_DIR / "data" / "app.db"  # 사용자·세션·실행 상태 (SQLite)
    upload_dir: Path = BACKEND_DIR / "data" / "uploads"  # 입력 화면에서 올린 제품 사진
    upload_max_mb: float = 10


settings = Settings()
