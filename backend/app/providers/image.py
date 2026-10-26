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
from app.core.guard import count_image_call

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

    async def edit(
        self, source: Path, request: str, references: list[Path], out_dir: Path, ratio: str, seed: int, pod: str
    ) -> Path:
        """이미 만든 이미지(source)를 사람의 수정 요청(request)대로 고친 새 이미지를 저장하고 경로를 돌려준다."""
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

    async def edit(
        self, source: Path, request: str, references: list[Path], out_dir: Path, ratio: str, seed: int, pod: str
    ) -> Path:
        return await self.generate("", references, out_dir, ratio, f"수정: {request}", seed, pod)


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

    async def edit(
        self, source: Path, request: str, references: list[Path], out_dir: Path, ratio: str, seed: int, pod: str
    ) -> Path:
        # 풀은 수정할 수 없으므로 같은 Pod·화면비의 다른 이미지를 고른다 (시연 장애 대비용)
        return await self.generate("", references, out_dir, ratio, "", seed + 1, pod)


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


_EDIT_PROMPT = """Edit the FIRST attached image according to the request below.

- Change only what the request asks for. Keep everything else — composition, framing, lighting, mood — as it is.
- The phone must stay exactly the device shown in the other attached official product images:
  same silhouette and proportion, exactly 2 rear lenses plus one LED flash, same body color.
- Output ONE continuous photograph. No collage, borders, bars, or panels.
- Render NO text, letters, numbers, logos, or watermarks.

Request: {request}
"""


class VertexGeminiProvider:
    """회사 GCP 프로젝트의 Vertex AI Gemini 이미지 모델. 원본 P2처럼 공식 제품 사진을 함께 보낸다."""

    async def generate(
        self, prompt: str, references: list[Path], out_dir: Path, ratio: str, label: str, seed: int, pod: str
    ) -> Path:
        _require_references(references)
        parts: list[types.Part | str] = [*map(_image_part, references), prompt]
        return _save_image(await self._call_with_backoff(parts, ratio, seed), out_dir)

    async def edit(
        self, source: Path, request: str, references: list[Path], out_dir: Path, ratio: str, seed: int, pod: str
    ) -> Path:
        _require_references(references)
        # 첫 첨부 = 고칠 이미지, 그 뒤 = 공식 제품 사진 (고치는 동안 제품 모양이 바뀌지 않게)
        parts: list[types.Part | str] = [
            _image_part(source),
            *map(_image_part, references),
            _EDIT_PROMPT.format(request=request),
        ]
        return _save_image(await self._call_with_backoff(parts, ratio, seed), out_dir)

    async def _call_with_backoff(
        self, parts: list[types.Part | str], ratio: str, seed: int
    ) -> types.GenerateContentResponse:
        """Vertex 이미지 모델은 공유 용량이 바쁠 때 429를 간헐적으로 돌려준다 (실측). 잠깐 기다렸다 다시 보낸다."""
        for wait in (*_RATE_LIMIT_WAITS, None):
            try:
                async with _vertex_slots():
                    response = await asyncio.wait_for(
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
                count_image_call()  # 429로 거절된 요청은 과금되지 않으므로 응답을 받은 것만 센다
                return response
            except genai_errors.ClientError as e:
                if e.code != 429 or wait is None:
                    raise
                logger.warning("Vertex 이미지 429, %d초 뒤 다시 시도합니다", wait)
                await asyncio.sleep(wait)
        raise AssertionError("unreachable")


def _require_references(references: list[Path]) -> None:
    if not references:
        # 원본 P2: 제품 사진(①)이 없으면 생성하지 않는다
        raise RuntimeError(
            f"공식 제품 사진이 없습니다. {settings.product_image_dir}에 "
            "closed_front / closed_back / unfolded 이미지를 넣어 주세요."
        )


def _image_part(path: Path) -> types.Part:
    return types.Part.from_bytes(data=path.read_bytes(), mime_type=mimetypes.guess_type(path.name)[0] or "image/png")


def _save_image(response: types.GenerateContentResponse, out_dir: Path) -> Path:
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


def get_image_provider() -> ImageProvider:
    providers: dict[str, type[ImageProvider]] = {
        "placeholder": PlaceholderProvider,
        "pool": PoolProvider,
        "vertex": VertexGeminiProvider,
    }
    return providers[settings.image_provider]()
