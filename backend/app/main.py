from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import auth, feedback, product_images, product_pages, profiles, runs, templates
from app.config import BACKEND_DIR, settings
from app.core.auth import SESSION_COOKIE, user_from_token
from app.core import store
from app.core.db import init_db
from app.core.guard import images_used_today
from app.providers.image import active_image_model

settings.data_dir.mkdir(parents=True, exist_ok=True)
settings.upload_dir.mkdir(parents=True, exist_ok=True)
init_db()
store.clear_unfinished_jobs()

app = FastAPI(title="CRM 시안 생성 프로토타입")


class StripBasePath:
    """/park/api/... 로 들어온 요청을 /api/... 로 바꿔 처리한다 (경로 없이 들어온 요청도 그대로 받는다)."""

    def __init__(self, app, base: str) -> None:
        self.app = app
        self.base = base.rstrip("/")

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if self.base and scope["type"] in ("http", "websocket") and (path == self.base or path.startswith(self.base + "/")):
            scope = {**scope, "path": path[len(self.base):] or "/"}
        await self.app(scope, receive, send)


# 정적 파일 마운트(생성 이미지·올린 사진)는 라우터 의존성이 걸리지 않아서, 로그인 검사를 여기서 한다
_PROTECTED_FILES = ("/api/files/", "/api/uploads/")


class RequireLoginForFiles:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope.get("path", "").startswith(_PROTECTED_FILES):
            cookies = dict(
                part.strip().split("=", 1)
                for key, value in scope.get("headers", [])
                if key == b"cookie"
                for part in value.decode("latin-1").split(";")
                if "=" in part
            )
            if user_from_token(cookies.get(SESSION_COOKIE)) is None:
                await JSONResponse({"detail": "로그인이 필요합니다."}, status_code=401)(scope, receive, send)
                return
        await self.app(scope, receive, send)


# 나중에 추가한 미들웨어가 바깥에서 먼저 돈다: 배포 경로를 뗀 뒤 로그인을 검사한다
app.add_middleware(RequireLoginForFiles)
app.add_middleware(StripBasePath, base=settings.base_path)
app.include_router(auth.router, prefix="/api")
app.include_router(runs.router, prefix="/api")
app.include_router(templates.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(profiles.router, prefix="/api")
app.include_router(product_pages.router, prefix="/api")
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
