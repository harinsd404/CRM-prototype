from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api import product_images, runs
from app.config import BACKEND_DIR, settings
from app.core.guard import images_used_today
from app.providers.image import active_image_model

settings.data_dir.mkdir(parents=True, exist_ok=True)
settings.upload_dir.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="CRM 시안 생성 프로토타입")
app.include_router(runs.router, prefix="/api")
# 라우터를 마운트보다 먼저 등록해야 POST /api/uploads가 아래 /api/uploads 마운트에 가려지지 않는다
app.include_router(product_images.router, prefix="/api")
# 생성된 이미지: /api/files/{run_id}/images/{파일명}
app.mount("/api/files", StaticFiles(directory=settings.data_dir), name="files")
# 입력 화면에서 올린 제품 사진: /api/uploads/{파일명}
app.mount("/api/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")
# 시안 HTML이 쓰는 폰트 등: /api/assets/fonts/SamsungOne-400.woff2
app.mount("/api/assets", StaticFiles(directory=BACKEND_DIR / "assets"), name="assets")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "llm_provider": settings.llm_provider,
        "llm_model": settings.vertex_text_model if settings.llm_provider == "vertex" else settings.llm_model,
        "image_provider": settings.image_provider,
        "image_model": active_image_model() if settings.image_provider == "vertex" else "-",
        "images_today": f"{images_used_today()}/{settings.image_daily_limit}",
    }


# 배포: 빌드된 프론트(frontend/dist)가 있으면 같은 포트의 / 에서 서빙한다. /api 라우트보다 뒤에 둬야 한다
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
