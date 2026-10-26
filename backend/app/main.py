from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api import runs
from app.config import BACKEND_DIR, settings
from app.core.guard import images_used_today

settings.data_dir.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="CRM 시안 생성 프로토타입")
app.include_router(runs.router, prefix="/api")
# 생성된 이미지: /api/files/{run_id}/images/{파일명}
app.mount("/api/files", StaticFiles(directory=settings.data_dir), name="files")
# 시안 HTML이 쓰는 폰트 등: /api/assets/fonts/SamsungOne-400.woff2
app.mount("/api/assets", StaticFiles(directory=BACKEND_DIR / "assets"), name="assets")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "llm_provider": settings.llm_provider,
        "llm_model": settings.vertex_text_model if settings.llm_provider == "vertex" else settings.llm_model,
        "image_provider": settings.image_provider,
        "images_today": f"{images_used_today()}/{settings.image_daily_limit}",
    }
