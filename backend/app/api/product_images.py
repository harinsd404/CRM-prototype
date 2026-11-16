from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.api.auth import current_user
from app.config import settings
from app.core.domain import MAX_EXTRA_PRODUCT_IMAGES
from app.core.image_check import ImageCheck, check_product_images
from app.core.profile import FOLD_PROFILE, ProductProfile
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
    """Fold 기본 프로필의 사진 자리와 assets/product 기본 사진 (템플릿 없이 시작할 때의 기본값)."""
    return [
        ProductImage(
            role=role,
            label=label,
            default_url=f"/api/assets/product/{path.name}" if (path := default_product_image(role)) else None,
        )
        for role, label in FOLD_PROFILE.slot_labels().items()
    ]


class CheckRequest(BaseModel):
    product_images: dict[str, str | None] = {}
    extra_product_images: list[str] = []
    profile: ProductProfile | None = None  # 없으면 Fold 기본 프로필 + assets/product 기본 사진


@router.post("/product-images/check", response_model=ImageCheck)
def check(body: CheckRequest) -> ImageCheck:
    """입력 화면에서 고른 제품 사진의 해상도·장 수·필수 자리를 검사한다 (경고만, 막지는 않는다)."""
    return check_product_images(
        body.product_images,
        body.extra_product_images[:MAX_EXTRA_PRODUCT_IMAGES],
        body.profile or FOLD_PROFILE,
        use_defaults=body.profile is None,
    )


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
