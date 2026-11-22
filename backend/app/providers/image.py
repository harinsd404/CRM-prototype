import asyncio
import logging
import mimetypes
import random
import shutil
import time
from dataclasses import dataclass
from functools import lru_cache
from html import escape
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.config import settings
from app.core.guard import count_image_call

# 자리표시 이미지의 화면비별 크기
IMAGE_SIZES: dict[str, tuple[int, int]] = {"1:1": (1024, 1024), "4:3": (1024, 768), "16:9": (1344, 768)}

logger = logging.getLogger(__name__)

_RATE_LIMIT_WAITS = (5, 15)  # 초
_primary_blocked_until = 0.0  # 기본 이미지 모델이 계속 429일 때, 이 시각(monotonic)까지는 대체 모델만 쓴다
_POOL_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".svg"}
_PALETTES = [("#f6d365", "#fda085"), ("#a1c4fd", "#c2e9fb"), ("#d4fc79", "#96e6a1"), ("#fbc2eb", "#a6c1ee")]


@dataclass(frozen=True)
class Reference:
    """참조 사진 하나와 그 앞에 붙이는 설명. 설명 없이 보내면 모델이 여러 대가 찍힌 시트·라인업 사진의
    '대수와 배열'까지 따라 그려서, 제품 프로필의 사진 자리 설명(caption)을 함께 보낸다."""

    path: Path
    caption: str


class ImageProvider(Protocol):
    async def generate(
        self, prompt: str, references: list[Reference], out_dir: Path, ratio: str, label: str, seed: int, pod: str
    ) -> Path:
        """prompt로 이미지 한 장을 만들어 out_dir에 저장하고 경로를 돌려준다.

        references는 참조 이미지(공식 제품 사진 등)와 설명, label은 자리표시 이미지에 쓰는 짧은 설명, pod는 Pod 영문 이름(풀 폴더 이름).
        """
        ...

    async def edit(
        self,
        source: Path,
        request: str,
        references: list[Reference],
        out_dir: Path,
        ratio: str,
        seed: int,
        pod: str,
        keep_rules: str = "",
    ) -> Path:
        """이미 만든 이미지(source)를 사람의 수정 요청(request)대로 고친 새 이미지를 저장하고 경로를 돌려준다.
        keep_rules는 고치는 동안 제품이 바뀌지 않게 지킬 규칙 (제품 프로필의 edit_rules)."""
        ...


class PlaceholderProvider:
    """GPU 없이 흐름을 확인하기 위한 SVG 자리표시 이미지."""

    async def generate(
        self, prompt: str, references: list[Reference], out_dir: Path, ratio: str, label: str, seed: int, pod: str
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
        self,
        source: Path,
        request: str,
        references: list[Reference],
        out_dir: Path,
        ratio: str,
        seed: int,
        pod: str,
        keep_rules: str = "",
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
        self, prompt: str, references: list[Reference], out_dir: Path, ratio: str, label: str, seed: int, pod: str
    ) -> Path:
        pod_images = _images(settings.image_pool_dir / pod)  # pod = Pod 영문 이름
        same_ratio = [p for p in pod_images if p.name.startswith(f"{pool_ratio_tag(ratio)}_")]
        pool = same_ratio or pod_images or _images(settings.image_pool_dir)
        if not pool:
            raise RuntimeError(f"이미지 풀이 비어 있습니다: {settings.image_pool_dir}")
        source = random.Random(seed).choice(pool)
        path = out_dir / f"{uuid4().hex[:8]}{source.suffix.lower()}"
        shutil.copyfile(source, path)
        return path

    async def edit(
        self,
        source: Path,
        request: str,
        references: list[Reference],
        out_dir: Path,
        ratio: str,
        seed: int,
        pod: str,
        keep_rules: str = "",
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
- The device must stay exactly the one shown in the other attached official product images.
{keep_rules}
- Keep exactly ONE device.
- Output ONE continuous photograph. No collage, borders, bars, or panels.
- Render NO text, letters, numbers, logos, or watermarks.
- No part of a face (eyes, nose, mouth, lips, chin) in the frame. If the image to edit shows one,
  crop or reframe so the top edge cuts below the chin — even if the request does not mention it.

Request: {request}
"""


def _reference_parts(references: list[Reference]) -> list[types.Part | str]:
    """참조 사진마다 무엇인지 설명을 앞에 붙여 끼워 넣는다."""
    parts: list[types.Part | str] = []
    for reference in references:
        parts += [reference.caption, _image_part(reference.path)]
    return parts


class VertexGeminiProvider:
    """회사 GCP 프로젝트의 Vertex AI Gemini 이미지 모델. 원본 P2처럼 공식 제품 사진을 함께 보낸다."""

    async def generate(
        self, prompt: str, references: list[Reference], out_dir: Path, ratio: str, label: str, seed: int, pod: str
    ) -> Path:
        _require_references(references)
        parts: list[types.Part | str] = [*_reference_parts(references), prompt]
        return _save_image(await self._call_with_backoff(parts, ratio, seed), out_dir)

    async def edit(
        self,
        source: Path,
        request: str,
        references: list[Reference],
        out_dir: Path,
        ratio: str,
        seed: int,
        pod: str,
        keep_rules: str = "",
    ) -> Path:
        _require_references(references)
        # 첫 첨부 = 고칠 이미지, 그 뒤 = 공식 제품 사진 (고치는 동안 제품 모양이 바뀌지 않게)
        parts: list[types.Part | str] = [
            "[Image to edit]",
            _image_part(source),
            *_reference_parts(references),
            _EDIT_PROMPT.format(request=request, keep_rules=keep_rules.strip()),
        ]
        return _save_image(await self._call_with_backoff(parts, ratio, seed), out_dir)

    async def _call_with_backoff(
        self, parts: list[types.Part | str], ratio: str, seed: int
    ) -> types.GenerateContentResponse:
        """기본 모델로 보내고, 기다렸다 다시 보내도 429가 계속되면(쿼터 소진, 실측) 대체 모델로 넘어간다.
        넘어간 뒤 image_fallback_minutes 동안은 기본 모델을 건너뛰어 매번 20초씩 기다리지 않게 한다."""
        global _primary_blocked_until
        fallback = settings.vertex_image_fallback_model
        if fallback and fallback != settings.vertex_image_model:
            if time.monotonic() < _primary_blocked_until:
                return await self._call_model(fallback, parts, ratio, seed)
            try:
                return await self._call_model(settings.vertex_image_model, parts, ratio, seed)
            except genai_errors.ClientError as e:
                if e.code != 429:
                    raise
                _primary_blocked_until = time.monotonic() + settings.image_fallback_minutes * 60
                logger.warning(
                    "%s 429가 계속되어 %s로 대체합니다 (%g분간)",
                    settings.vertex_image_model,
                    fallback,
                    settings.image_fallback_minutes,
                )
                return await self._call_model(fallback, parts, ratio, seed)
        return await self._call_model(settings.vertex_image_model, parts, ratio, seed)

    async def _call_model(
        self, model: str, parts: list[types.Part | str], ratio: str, seed: int
    ) -> types.GenerateContentResponse:
        """Vertex 이미지 모델은 공유 용량이 바쁠 때 429를 간헐적으로 돌려준다 (실측). 잠깐 기다렸다 다시 보낸다."""
        for wait in (*_RATE_LIMIT_WAITS, None):
            try:
                async with _vertex_slots():
                    response = await asyncio.wait_for(
                        _vertex_client().aio.models.generate_content(
                            model=model,
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
                logger.warning("Vertex 이미지 429 (%s), %d초 뒤 다시 시도합니다", model, wait)
                await asyncio.sleep(wait)
        raise AssertionError("unreachable")


def _require_references(references: list[Reference]) -> None:
    if not references:
        # 원본 P2: 제품 사진(①)이 없으면 생성하지 않는다
        raise RuntimeError(
            "이 장면의 제품 상태에 필요한 공식 제품 사진(그 상태의 주 참조 사진)이 없습니다. "
            f"입력 화면에서 사진을 올리거나 {settings.product_image_dir}에 넣고 다시 시작해 주세요."
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


def active_image_model() -> str:
    """지금 실제로 쓰는 이미지 모델 (대체 중이면 대체 모델). /api/health에서 보여준다."""
    if settings.vertex_image_fallback_model and time.monotonic() < _primary_blocked_until:
        return f"{settings.vertex_image_fallback_model} (대체 중: {settings.vertex_image_model} 429)"
    return settings.vertex_image_model
