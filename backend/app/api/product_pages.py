import io
import logging
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from app.api.auth import CurrentUser
from app.config import settings
from app.core import guard
from app.steps.product_page import (
    PageError,
    PageImportRequest,
    PageImportResult,
    page_client,
    download_image,
    import_product_page,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/product-pages", tags=["product-pages"])

_SAVE_FORMATS = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp"}  # 이미지 모델이 받는 형식
MAX_IMPORT_IMAGES = 10


@router.post("/import", response_model=PageImportResult)
async def import_page(body: PageImportRequest, user: CurrentUser) -> PageImportResult:
    """삼성닷컴 제품 페이지에서 제품명·컬러·Pod별 스펙(AI가 정리)과 제품 사진 후보를 가져온다. 입력 화면에 채우기 전 미리보기."""
    guard.check_generate_rate()
    try:
        return await import_product_page(body)
    except PageError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        logger.exception("제품 페이지 가져오기 실패")
        raise HTTPException(502, f"제품 페이지를 정리하지 못했습니다: {e}") from e


class ImageImportRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=MAX_IMPORT_IMAGES)


class ImportedImage(BaseModel):
    source: str
    name: str  # 올린 사진 이름 (RunInput.product_images 등에 넣는 값)
    url: str


@router.post("/images", response_model=list[ImportedImage])
async def import_images(body: ImageImportRequest, user: CurrentUser) -> list[ImportedImage]:
    """고른 사진 후보(images.samsung.com)를 받아 올린 사진으로 저장한다. 직접 올린 사진과 똑같이 쓴다."""
    out: list[ImportedImage] = []
    async with page_client() as client:
        for url in dict.fromkeys(body.urls):
            data = await download_image(client, url)
            if not data or len(data) > settings.upload_max_mb * 1024 * 1024:
                continue
            try:
                with Image.open(io.BytesIO(data)) as image:
                    suffix = _SAVE_FORMATS.get(image.format or "")
            except (OSError, UnidentifiedImageError):
                suffix = None
            if suffix is None:
                continue
            name = f"{uuid4().hex}{suffix}"
            settings.upload_dir.mkdir(parents=True, exist_ok=True)
            (settings.upload_dir / name).write_bytes(data)
            out.append(ImportedImage(source=url, name=name, url=f"/api/uploads/{name}"))
    if not out:
        raise HTTPException(502, "사진을 가져오지 못했습니다. 다시 시도하거나 직접 올려 주세요.")
    return out
