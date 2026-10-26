import asyncio
import logging
import mimetypes
import random
import shutil
from functools import lru_cache
from html import escape
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.config import settings
from app.core.domain import POD_ENGLISH

# 자리표시 이미지의 화면비별 크기
IMAGE_SIZES: dict[str, tuple[int, int]] = {"1:1": (1024, 1024), "4:3": (1024, 768), "16:9": (1344, 768)}

logger = logging.getLogger(__name__)

_RATE_LIMIT_WAITS = (5, 15)  # 초
_POOL_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".svg"}
_PALETTES = [("#f6d365", "#fda085"), ("#a1c4fd", "#c2e9fb"), ("#d4fc79", "#96e6a1"), ("#fbc2eb", "#a6c1ee")]


class ImageProvider(Protocol):
    async def generate(
        self, prompt: str, references: list[Path], out_dir: Path, ratio: str, label: str, seed: int, pod: str
    ) -> Path:
        """prompt로 이미지 한 장을 만들어 out_dir에 저장하고 경로를 돌려준다.

        references는 참조 이미지(공식 제품 사진 등), label은 자리표시 이미지에 쓰는 짧은 설명, pod는 Pod 이름.
        """
        ...


class PlaceholderProvider:
    """GPU 없이 흐름을 확인하기 위한 SVG 자리표시 이미지."""

    async def generate(
        self, prompt: str, references: list[Path], out_dir: Path, ratio: str, label: str, seed: int, pod: str
    ) -> Path:
        width, height = IMAGE_SIZES[ratio]
        start, end = _PALETTES[seed % len(_PALETTES)]
        text = escape(f"{ratio} · " + label[:50] + ("…" if len(label) > 50 else ""))
        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="{start}"/><stop offset="1" stop-color="{end}"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="50%" y="50%" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#333">{text}</text>
</svg>"""
        path = out_dir / f"{uuid4().hex[:8]}.svg"
        path.write_text(svg, encoding="utf-8")
        return path


def pool_ratio_tag(ratio: str) -> str:
    return ratio.replace(":", "x")  # 파일 이름에 콜론을 쓰지 않는다 (16:9 → 16x9)


def _images(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in _POOL_SUFFIXES)


class PoolProvider:
    """assets/image_pool의 미리 만든 이미지에서 고른다. 시연 중 Vertex 장애 대비용.

    image_pool/{Pod 영문명}/{16x9 등}_*.png 중 같은 Pod·화면비를 먼저 고르고, 없으면 같은 Pod, 그다음 풀 맨 위.
    scripts/save_pool.py로 실행 하나의 이미지를 이 구조로 저장할 수 있다.
    """

    async def generate(
        self, prompt: str, references: list[Path], out_dir: Path, ratio: str, label: str, seed: int, pod: str
    ) -> Path:
        pod_images = _images(settings.image_pool_dir / POD_ENGLISH[pod])
        same_ratio = [p for p in pod_images if p.name.startswith(f"{pool_ratio_tag(ratio)}_")]
        pool = same_ratio or pod_images or _images(settings.image_pool_dir)
        if not pool:
            raise RuntimeError(f"이미지 풀이 비어 있습니다: {settings.image_pool_dir}")
        source = random.Random(seed).choice(pool)
        path = out_dir / f"{uuid4().hex[:8]}{source.suffix.lower()}"
        shutil.copyfile(source, path)
        return path


@lru_cache
def _vertex_client() -> genai.Client:
    return genai.Client(
        vertexai=True,
        project=settings.google_cloud_project or None,
        location=settings.google_cloud_location,
    )


@lru_cache
def _vertex_slots() -> asyncio.Semaphore:
    return asyncio.Semaphore(settings.image_concurrency)


class VertexGeminiProvider:
    """회사 GCP 프로젝트의 Vertex AI Gemini 이미지 모델. 원본 P2처럼 공식 제품 사진을 함께 보낸다."""

    async def generate(
        self, prompt: str, references: list[Path], out_dir: Path, ratio: str, label: str, seed: int, pod: str
    ) -> Path:
        if not references:
            # 원본 P2: 제품 사진(①)이 없으면 생성하지 않는다
            raise RuntimeError(
                f"공식 제품 사진이 없습니다. {settings.product_image_dir}에 "
                "closed_front / closed_back / unfolded 이미지를 넣어 주세요."
            )
        parts: list[types.Part | str] = [
            types.Part.from_bytes(data=ref.read_bytes(), mime_type=mimetypes.guess_type(ref.name)[0] or "image/png")
            for ref in references
        ]
        parts.append(prompt)

        response = await self._call_with_backoff(parts, ratio, seed)
        candidate = response.candidates[0] if response.candidates else None
        for part in candidate.content.parts if candidate and candidate.content else []:
            if part.inline_data and part.inline_data.data:
                suffix = mimetypes.guess_extension(part.inline_data.mime_type or "image/png") or ".png"
                path = out_dir / f"{uuid4().hex[:8]}{suffix}"
                path.write_bytes(part.inline_data.data)
                return path
        # 이미지 대신 글만 왔거나(예: 첨부 누락 안내) 안전 필터에 걸린 경우
        reason = (response.text or "").strip() or (candidate.finish_reason if candidate else "응답 없음")
        raise RuntimeError(f"이미지가 생성되지 않았습니다: {reason}")

    async def _call_with_backoff(self, parts: list[types.Part | str], ratio: str, seed: int) -> types.GenerateContentResponse:
        """Vertex 이미지 모델은 공유 용량이 바쁠 때 429를 간헐적으로 돌려준다 (실측). 잠깐 기다렸다 다시 보낸다."""
        for wait in (*_RATE_LIMIT_WAITS, None):
            try:
                async with _vertex_slots():
                    return await asyncio.wait_for(
                        _vertex_client().aio.models.generate_content(
                            model=settings.vertex_image_model,
                            contents=parts,
                            config=types.GenerateContentConfig(
                                response_modalities=["TEXT", "IMAGE"],
                                image_config=types.ImageConfig(aspect_ratio=ratio),
                                seed=seed,
                            ),
                        ),
                        settings.image_timeout,
                    )
            except genai_errors.ClientError as e:
                if e.code != 429 or wait is None:
                    raise
                logger.warning("Vertex 이미지 429, %d초 뒤 다시 시도합니다", wait)
                await asyncio.sleep(wait)
        raise AssertionError("unreachable")


def get_image_provider() -> ImageProvider:
    providers: dict[str, type[ImageProvider]] = {
        "placeholder": PlaceholderProvider,
        "pool": PoolProvider,
        "vertex": VertexGeminiProvider,
    }
    return providers[settings.image_provider]()
