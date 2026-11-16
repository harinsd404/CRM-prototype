from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.api.auth import current_user
from app.config import settings
from app.core.domain import PRODUCT_IMAGE_LABELS
from app.core.store import default_product_image

router = APIRouter(tags=["product-images"], dependencies=[Depends(current_user)])

# 이미지 모델에 그대로 보내므로 Vertex가 받는 형식만 받는다
_UPLOAD_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


class ProductImage(BaseModel):
    role: str
    label: str
    default_url: str | None  # assets/product에 기본 사진이 없으면 null


class Upload(BaseModel):
    name: str  # RunInput.product_images에 넣는 값
    url: str


@router.get("/product-images", response_model=list[ProductImage])
def list_product_images() -> list[ProductImage]:
    """입력 화면에 보여 줄 공식 제품 사진 5자리와 기본 사진."""
    return [
        ProductImage(
            role=role,
            label=label,
            default_url=f"/api/assets/product/{path.name}" if (path := default_product_image(role)) else None,
        )
        for role, label in PRODUCT_IMAGE_LABELS.items()
    ]


@router.post("/uploads", response_model=Upload)
async def upload(request: Request) -> Upload:
    """사진 파일을 body 그대로 받는다 (multipart 의존성 없이). Content-Type으로 형식을 정한다."""
    content_type = request.headers.get("content-type", "").split(";")[0].strip()
    if content_type not in _UPLOAD_TYPES:
        raise HTTPException(415, "PNG, JPG, WEBP 사진만 올릴 수 있습니다.")
    data = await request.body()
    if not data:
        raise HTTPException(400, "빈 파일입니다.")
    if len(data) > settings.upload_max_mb * 1024 * 1024:
        raise HTTPException(413, f"사진은 {settings.upload_max_mb:g}MB 이하만 올릴 수 있습니다.")

    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    name = f"{uuid4().hex}{_UPLOAD_TYPES[content_type]}"
    (settings.upload_dir / name).write_bytes(data)
    return Upload(name=name, url=f"/api/uploads/{name}")
