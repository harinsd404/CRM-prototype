import logging

from fastapi import APIRouter, HTTPException

from app.api.auth import CurrentUser
from app.core import guard
from app.core.profile import FOLD_PROFILE, ProductProfile
from app.steps.profile import ProfileRequest, ProfileResult, generate_profile

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/profiles", tags=["profiles"])


@router.get("/default", response_model=ProductProfile)
def default_profile(user: CurrentUser) -> ProductProfile:
    """템플릿 없이 시작할 때 쓰는 기본 프로필 (Galaxy Z Fold)."""
    return FOLD_PROFILE


@router.post("/generate", response_model=ProfileResult)
async def generate(body: ProfileRequest, user: CurrentUser) -> ProfileResult:
    """제품 정보와 올린 사진으로 제품 프로필(프롬프트의 제품별 블록)을 AI가 만든다.
    사진마다 자리를 정해 돌려주고, 사진이 부족하거나 흐리면 warnings로 알린다."""
    guard.check_generate_rate()
    try:
        return await generate_profile(body)
    except ValueError as e:  # 올린 사진을 찾을 수 없음
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        logger.exception("제품 프로필 생성 실패")
        raise HTTPException(502, str(e)) from e
