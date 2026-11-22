"""기본 이미지(이미지 생성에 쓰는 공식 제품 사진) 검사. 코드로 잴 수 있는 것만 본다 (AI를 쓰지 않는다).

- 필수 자리가 비었는지: 그 제품 상태의 이미지를 만들 수 없다
- 해상도: 긴 변이 MIN_LONG_SIDE보다 작으면 이미지 모델이 제품 디테일(카메라·힌지 등)을 뭉개기 쉽다
  (짧은 변으로 재면 가로로 긴 컬러 라인업 사진까지 걸려서 긴 변으로 잰다)
- 장 수: 참조가 적으면 제품을 지어내기 쉽다
"""

from pathlib import Path

from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel

from app.core.profile import ProductProfile
from app.core.store import default_product_image, upload_path

MIN_LONG_SIDE = 1000
MIN_IMAGES = 4  # 상태별 주 참조 + 다른 각도·디테일 사진. 제품마다 상태 수가 달라도 이 정도는 있어야 지어내지 않는다


class ImageInfo(BaseModel):
    width: int
    height: int
    warning: str | None = None


class ImageCheck(BaseModel):
    images: dict[str, ImageInfo]  # 자리 이름 또는 추가 사진의 올린 파일 이름 → 크기
    warnings: list[str]


def image_size(path: Path) -> tuple[int, int] | None:
    try:
        with Image.open(path) as image:
            return image.size
    except (OSError, UnidentifiedImageError):
        return None


def _info(path: Path, label: str, warnings: list[str]) -> ImageInfo | None:
    size = image_size(path)
    if size is None:
        warnings.append(f"{label}: 사진 파일을 읽을 수 없습니다.")
        return None
    width, height = size
    warning = None
    if max(width, height) < MIN_LONG_SIDE:
        warning = f"화질이 낮습니다 ({width}×{height}). 긴 변 {MIN_LONG_SIDE}px 이상을 권장합니다."
        warnings.append(f"{label}: {warning}")
    return ImageInfo(width=width, height=height, warning=warning)


def check_product_images(
    product_images: dict[str, str | None], extras: list[str], profile: ProductProfile, fold_photos: bool
) -> ImageCheck:
    """product_images는 RunInput과 같은 뜻: 없는 자리 = assets/product 기본 사진(fold_photos일 때만), None = 지움,
    문자열 = 올린 파일. 필수 자리는 제품 프로필에서 상태의 주 참조로 쓰이는 자리다."""
    images: dict[str, ImageInfo] = {}
    warnings: list[str] = []
    required = profile.required_slots()
    for role, label in profile.slot_labels().items():
        choice = product_images.get(role, "")
        path = None
        if choice:
            try:
                path = upload_path(choice)
            except ValueError:
                warnings.append(f"{label}: 올린 사진을 찾을 수 없습니다.")
        elif choice is not None and fold_photos:
            path = default_product_image(role)
        if path is None:
            if role in required:
                warnings.append(f"{label} 사진이 없으면 그 상태의 제품 이미지는 만들 수 없습니다.")
            continue
        if info := _info(path, label, warnings):
            images[role] = info
    for i, name in enumerate(extras, 1):
        try:
            path = upload_path(name)
        except ValueError:
            warnings.append(f"추가 사진 {i}: 올린 사진을 찾을 수 없습니다.")
            continue
        if info := _info(path, f"추가 사진 {i}", warnings):
            images[name] = info
    count = len(images)
    if count < MIN_IMAGES:
        warnings.append(
            f"제품 사진이 {count}장뿐입니다. 제품을 지어내지 않도록 {MIN_IMAGES}장 이상(다른 각도·디테일 포함)을 권장합니다."
        )
    return ImageCheck(images=images, warnings=warnings)
