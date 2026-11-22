"""삼성닷컴 제품 페이지 URL에서 입력 데이터(제품명·컬러·Pod별 스펙)와 제품 사진 후보를 가져온다.

- 페이지: 주소에서 제품 기본 경로를 구해 제품 정보(/), 스펙(specs/), 구매(buy/) 페이지를 받는다. 없는 페이지는 건너뛴다.
  HTML 구조(선택자)에 기대지 않고 글자만 뽑아 텍스트 LLM이 정리한다. 페이지 구조가 바뀌어도 덜 깨지게 하려는 것.
- 스펙: 페이지 원문에 있는 사실만 쓴다. 카피의 팩트체크 근거가 이 글이라, 원문에 없는 수치는 코드가 다시 찾아 경고한다.
- 사진: 페이지의 images.samsung.com 이미지 중 아이콘·모바일용 중복을 빼고 크기를 재서 후보로 돌려준다.
  어느 사진을 제품 사진으로 쓸지는 사람이 고른다 (마케팅 이미지는 글자·연출이 섞여 참조 사진으로 맞지 않는 것이 많다).

보안: 서버가 사용자가 준 주소를 대신 받으므로(SSRF) 삼성닷컴 주소만 받고, 리다이렉트도 삼성닷컴과
삼성닷컴의 접속 대기열(queue-it)만 따라간다. 사진은 images.samsung.com만 받는다.
"""

import asyncio
import html
import io
import logging
import re
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from app.config import settings
from app.core.domain import MAX_PODS, POD_NAME_MAX
from app.core.prompts import load_prompt
from app.llm import get_chat_model
from app.steps.copy import unsourced_numbers

logger = logging.getLogger(__name__)

PAGE_HOSTS = ("www.samsung.com", "samsung.com")
_REDIRECT_HOST_SUFFIXES = (".samsung.com", ".queue-it.net")
IMAGE_HOST = "images.samsung.com"
_SUB_PAGES = ("", "specs/", "buy/")  # 제품 정보 · 스펙 · 구매(제품 사진 갤러리)
_PAGE_NAMES = {"": "제품 정보 페이지", "specs/": "스펙 페이지", "buy/": "구매 페이지"}
_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0 Safari/537.36"
)
_MAX_REDIRECTS = 8
_MAX_PAGE_BYTES = 8 * 1024 * 1024
_MAX_IMAGE_BYTES = 10 * 1024 * 1024
# LLM에 보낼 글자 수 (공통 부분을 뺀 뒤). 스펙·구매 페이지를 먼저 이 한도까지 담고, 남은 예산을 제품 정보 페이지가 쓴다.
# 실측: 버즈4 프로는 스펙 페이지가 화면에서 그려져 비어 있고(520자) 배터리 수치가 제품 정보 페이지 34,000자 뒤의 각주에
# 있었다 — 페이지마다 고정 30,000자로 자르면 빠진다
_TEXT_BUDGET = 80_000
_PAGE_TEXT_LIMIT = {"specs/": 30_000, "buy/": 8_000}
_CHROME_RUN = 6  # 이만큼 연속된 줄이 모든 페이지에 똑같이 있으면 사이트 공통 부분(메뉴·팝업)
_MIN_PAGE_TEXT = 200
_MIN_SPECS_TEXT = 2_000  # 이보다 짧으면 스펙 표가 없는 스펙 페이지 (버즈처럼 화면에서 그리는 경우)
_HEAD_BYTES = 256 * 1024  # 사진 크기는 파일 앞부분(헤더)만 읽어 잰다
_MAX_PROBE = 120  # 크기를 재 볼 이미지 수
MAX_CANDIDATES = 60
MIN_LONG_SIDE = 600
MIN_SHORT_SIDE = 300
_MAX_ASPECT = 3  # 이보다 가로(세로)로 길면 띠 배너

_IMAGE_URL = re.compile(r"(?:https:)?//images\.samsung\.com/[^\s\"'()<>\\]+?\.(?:png|jpe?g|webp)", re.IGNORECASE)
# 모바일·저화질 중복, 아이콘·로고·배너처럼 제품 사진이 아닌 것
_SKIP_IMAGE = re.compile(
    r"(-mo[.\-_]|_mo[.\-_]|lowband|thumbnail|icon|logo|qrcode|banner|bubble|badge|sprite|-text|/_pub/|/kdp/event/|/kdp/common/)",
    re.IGNORECASE,
)


class PageError(ValueError):
    """사용자에게 그대로 보여 줄 수 있는 오류 (잘못된 주소, 페이지를 받을 수 없음)."""


# ---------- 주소 ----------


def page_url(url: str) -> str:
    """사용자가 준 주소가 삼성닷컴 제품 페이지인지 확인하고, https·www·끝 '/'로 맞춘다 (쿼리는 버림)."""
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or (parts.hostname or "").lower() not in PAGE_HOSTS:
        raise PageError("삼성닷컴 제품 페이지 주소만 가져올 수 있습니다 (예: https://www.samsung.com/sec/smartphones/galaxy-z-fold8/).")
    path = parts.path if parts.path.endswith("/") else parts.path + "/"
    if path.count("/") < 4:  # /sec/ 첫 화면, /sec/smartphones/ 분류 화면
        raise PageError("제품 하나의 페이지 주소를 넣어 주세요.")
    return urlunsplit(("https", "www.samsung.com", path, "", ""))


def product_base_url(url: str) -> str:
    """제품 기본 경로. specs/·buy/ 주소를 줘도 같은 제품으로 본다."""
    url = page_url(url)
    return re.sub(r"(specs|buy|reviews|compare)/$", "", url)


# ---------- 페이지 받기 ----------


async def _get(
    client: httpx.AsyncClient, url: str, max_bytes: int, truncate: bool = False
) -> tuple[str, bytes] | None:
    """리다이렉트를 직접 따라가며 허용한 곳인지 확인한다. 404 등은 None. 돌려주는 값: (최종 주소, 본문).
    max_bytes를 넘으면 None, truncate면 앞부분만 돌려준다 (사진 크기만 잴 때)."""
    for _ in range(_MAX_REDIRECTS):
        async with client.stream("GET", url) as response:
            if response.is_redirect:
                url = urljoin(url, response.headers.get("location", ""))
                host = (urlsplit(url).hostname or "").lower()
                if urlsplit(url).scheme != "https" or not (host in PAGE_HOSTS or host.endswith(_REDIRECT_HOST_SUFFIXES)):
                    logger.warning("허용하지 않은 곳으로 리다이렉트: %s", url)
                    return None
                continue
            if response.status_code != 200:
                return None
            body = b""
            async for chunk in response.aiter_bytes():
                body += chunk
                if len(body) > max_bytes:
                    return (url, body[:max_bytes]) if truncate else None
            return url, body
    return None


def page_text(raw: str) -> str:
    """HTML에서 글자만 줄 단위로. 스크립트·스타일·주석은 버리고, 이미지 대체 글(alt)은 장면 설명이라 남긴다."""
    text = re.sub(r"(?is)<!--.*?-->|<script\b.*?</script>|<style\b.*?</style>|<noscript\b.*?</noscript>|<svg\b.*?</svg>", " ", raw)
    text = re.sub(r"(?is)<img\b[^>]*?\balt=\"([^\"]{8,})\"[^>]*>", r"\n\1\n", text)
    text = html.unescape(re.sub(r"<[^>]+>", "\n", text))
    lines: list[str] = []
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if line and (not lines or lines[-1] != line):
            lines.append(line)
    return "\n".join(lines)


def drop_site_chrome(pages: dict[str, list[str]]) -> dict[str, list[str]]:
    """모든 페이지에 똑같이 들어 있는 연속된 줄 묶음(메뉴·팝업·약관 같은 사이트 공통 부분)을 지운다.
    _CHROME_RUN줄짜리 묶음이 모든 페이지에 있으면 공통 부분으로 본다. 제품 내용이 두 페이지에 겹쳐도
    모든 페이지에 같은 순서로 나오는 일은 드물다."""
    if len(pages) < 2:
        return pages
    n = _CHROME_RUN
    shingle_sets = [
        {tuple(lines[i : i + n]) for i in range(len(lines) - n + 1)} for lines in pages.values()
    ]
    common = set.intersection(*shingle_sets)
    out: dict[str, list[str]] = {}
    for sub, lines in pages.items():
        drop = [False] * len(lines)
        for i in range(len(lines) - n + 1):
            if tuple(lines[i : i + n]) in common:
                drop[i : i + n] = [True] * n
        out[sub] = [line for line, d in zip(lines, drop) if not d]
    return out


def image_urls(raw: str) -> list[str]:
    """페이지의 제품 사진 후보 주소 (나온 순서, 중복·아이콘·모바일용 제외)."""
    found: dict[str, None] = {}
    for match in _IMAGE_URL.findall(raw):
        url = "https:" + match if match.startswith("//") else match
        if not _SKIP_IMAGE.search(url):
            found[url] = None
    return list(found)


class FetchedPages(BaseModel):
    base_url: str
    texts: dict[str, str]  # 하위 경로("", "specs/", "buy/") → 글
    image_urls: list[str]  # 구매 페이지(제품 사진 갤러리) 것이 먼저


def page_client() -> httpx.AsyncClient:
    # 쿠키를 유지해야 접속 대기열(queue-it) 리다이렉트를 통과한다
    return httpx.AsyncClient(
        headers={"User-Agent": _USER_AGENT, "Accept-Language": "ko-KR,ko;q=0.9"},
        timeout=httpx.Timeout(20, connect=10),
        follow_redirects=False,
    )


def _same_path(a: str, b: str) -> bool:
    return urlsplit(a).path.rstrip("/") == urlsplit(b).path.rstrip("/")


async def fetch_pages(url: str) -> FetchedPages:
    first_url = page_url(url)
    async with page_client() as client:
        # 준 주소부터 받아 실제로 도착한 곳으로 제품 경로를 정한다 (모델 주소 SM-…/는 구매 페이지로 넘어간다)
        first = await _get(client, first_url, _MAX_PAGE_BYTES)
        # 판매가 끝난 제품은 전체 목록(all-smartphones 등)으로 넘어간다. 그때는 준 주소 그대로 쓴다
        moved = first and "queue-it.net" not in first[0] and "/all-" not in urlsplit(first[0]).path
        landed = first[0] if moved else first_url
        if not moved:
            first = None
        base = product_base_url(landed)
        rest = [sub for sub in _SUB_PAGES if not (first and _same_path(landed, base + sub))]
        results = await asyncio.gather(
            *(_get(client, base + sub, _MAX_PAGE_BYTES) for sub in rest), return_exceptions=True
        )
    fetched = dict(zip(rest, results))
    if first and (sub := next((s for s in _SUB_PAGES if _same_path(landed, base + s)), None)) is not None:
        fetched[sub] = first
    lines: dict[str, list[str]] = {}
    images: dict[str, list[str]] = {}
    for sub in _SUB_PAGES:
        result = fetched.get(sub)
        if isinstance(result, BaseException) or result is None:
            if isinstance(result, BaseException):
                logger.warning("페이지 받기 실패 %s%s: %s", base, sub, result)
            continue
        final_url, body = result
        # 접속 대기열(출시 직후 등)에 걸렸거나, 없는 페이지라 다른 곳(전체 목록 등)으로 넘어간 경우
        if "queue-it.net" in final_url or not _same_path(final_url, base + sub):
            continue
        raw = body.decode("utf-8", errors="ignore")
        lines[sub] = page_text(raw).splitlines()
        images[sub] = image_urls(raw)
    texts: dict[str, str] = {}
    for sub, kept in drop_site_chrome(lines).items():
        text = "\n".join(kept)
        if len(text) >= _MIN_PAGE_TEXT:  # 공통 부분을 빼고 남는 게 없으면 제품 내용이 없는 페이지
            texts[sub] = text
    # 스펙 페이지가 없으면(워치·가전 등) 구매 페이지에 스펙이 있으므로 더 많이 보낸다
    has_specs = len(texts.get("specs/", "")) >= _MIN_SPECS_TEXT
    for sub in ("specs/", "buy/"):
        if sub in texts:
            limit = _PAGE_TEXT_LIMIT["specs/"] if sub == "buy/" and not has_specs else _PAGE_TEXT_LIMIT[sub]
            texts[sub] = texts[sub][:limit]
    if "" in texts:
        texts[""] = texts[""][: _TEXT_BUDGET - sum(len(t) for s, t in texts.items() if s)]
    if not texts:
        raise PageError(
            "페이지를 받지 못했습니다. 주소가 맞는지 확인해 주세요. "
            "출시 직후라 접속 대기열이 걸려 있으면 잠시 뒤 다시 시도해 주세요."
        )
    ordered = [*images.get("buy/", []), *images.get("", []), *images.get("specs/", [])]
    return FetchedPages(base_url=base, texts=texts, image_urls=list(dict.fromkeys(ordered)))


# ---------- 사진 후보 ----------


class ImageCandidate(BaseModel):
    url: str
    width: int
    height: int


def _image_size(data: bytes) -> tuple[int, int] | None:
    try:
        with Image.open(io.BytesIO(data)) as image:
            return image.size
    except (OSError, UnidentifiedImageError):
        return None


async def download_image(client: httpx.AsyncClient, url: str, head_only: bool = False) -> bytes | None:
    """images.samsung.com 사진만 받는다. head_only면 크기를 잴 앞부분만."""
    if (urlsplit(url).hostname or "").lower() != IMAGE_HOST or urlsplit(url).scheme != "https":
        return None
    if head_only:
        result = await _get(client, url, _HEAD_BYTES, truncate=True)
    else:
        result = await _get(client, url, _MAX_IMAGE_BYTES)
    if result is None or (urlsplit(result[0]).hostname or "").lower() != IMAGE_HOST:
        return None
    return result[1]


async def image_candidates(urls: list[str]) -> list[ImageCandidate]:
    """사진 앞부분으로 크기를 재고, 제품 사진으로 쓰기에 너무 작거나(아이콘·버튼) 가로로 긴 것(띠 배너)은 뺀다."""
    semaphore = asyncio.Semaphore(8)

    async def probe(client: httpx.AsyncClient, url: str) -> ImageCandidate | None:
        async with semaphore:
            try:
                data = await download_image(client, url, head_only=True)
            except httpx.HTTPError:
                return None
        size = _image_size(data) if data else None
        if size is None or max(size) < MIN_LONG_SIDE or min(size) < MIN_SHORT_SIDE:
            return None
        if max(size) > _MAX_ASPECT * min(size):
            return None
        return ImageCandidate(url=url, width=size[0], height=size[1])

    async with page_client() as client:
        probed = await asyncio.gather(*(probe(client, url) for url in urls[:_MAX_PROBE]))
    return [c for c in probed if c][:MAX_CANDIDATES]


# ---------- 입력 데이터 정리 (LLM) ----------


class PagePod(BaseModel):
    name: str = Field(description="Pod 이름. [지금 Pod]가 있으면 그 이름 그대로")
    key: str = Field(description="영문 소문자·숫자·_ 이름 (예: design, camera)")
    spec: str = Field(description="이 Pod의 스펙(Fact). 페이지 원문에 있는 사실만, 수치·공식 표기는 원문 그대로")


class PageInfo(BaseModel):
    product_name: str = Field(description="영문 공식 제품명 (예: Galaxy Z Fold8)")
    colors: list[str] = Field(description="이 모델의 컬러 이름, 페이지 표기 그대로 (한국어)")
    pods: list[PagePod]
    warnings: list[str] = Field(default=[], description="한국어. 페이지에서 찾지 못한 것, 헷갈린 것")


class PageImportRequest(BaseModel):
    url: str = Field(min_length=1, max_length=500)
    pods: list[str] = Field(default=[], max_length=MAX_PODS, description="입력 화면의 지금 Pod 이름 (스펙을 이 Pod별로 나눈다)")


class PageImportResult(BaseModel):
    base_url: str
    product_name: str
    colors: str  # 입력 형식 그대로 (쉼표 구분)
    pods: list[PagePod]
    images: list[ImageCandidate]
    warnings: list[str]


def _pages_block(pages: FetchedPages) -> str:
    return "\n\n".join(f"===== {_PAGE_NAMES[sub]} ({pages.base_url}{sub}) =====\n{text}" for sub, text in pages.texts.items())


async def _ask(request: PageImportRequest, pages: FetchedPages) -> PageInfo:
    pods = "\n".join(f"- {name}" for name in request.pods) or "(없음 — 페이지 내용으로 4~6개를 제안)"
    model = get_chat_model().with_structured_output(PageInfo, method="json_schema")
    chain = load_prompt("product_page") | model
    variables = {
        "url": pages.base_url,
        "pods": pods,
        "pages": _pages_block(pages),
        "max_pods": str(MAX_PODS),
        "pod_name_max": str(POD_NAME_MAX),
    }
    return await asyncio.wait_for(chain.ainvoke(variables), settings.llm_timeout * 2)


def _mock_info(request: PageImportRequest, pages: FetchedPages) -> PageInfo:
    """LLM_PROVIDER=mock: 페이지 제목만 제품명으로 쓴다."""
    title = next((line for line in pages.texts.get("", "").splitlines() if line.startswith("Galaxy")), "")
    return PageInfo(
        product_name=title or "[mock] 제품",
        colors=[],
        pods=[PagePod(name=name, key="", spec="") for name in request.pods],
        warnings=["[예시] mock 모드라 페이지를 정리하지 않았습니다. 제품명만 채웠습니다."],
    )


def _check(info: PageInfo, pages: FetchedPages, request: PageImportRequest) -> list[str]:
    """원문에 없는 수치(지어냈거나 다른 모델 것을 옮김)와 Pod 이름을 코드로 다시 확인한다."""
    source = "\n".join(pages.texts.values())
    warnings = list(info.warnings)
    for pod in info.pods:
        if missing := unsourced_numbers(pod.spec, source):
            warnings.append(f"{pod.name}: 페이지에서 찾지 못한 수치가 있습니다 ({', '.join(missing)}). 확인해 주세요.")
    if request.pods:
        got = {pod.name for pod in info.pods}
        if empty := [name for name in request.pods if name not in got]:
            warnings.append(f"페이지에서 스펙을 찾지 못한 Pod: {', '.join(empty)}")
    if long := [pod.name for pod in info.pods if pod.name not in request.pods and len(pod.name) > POD_NAME_MAX]:
        warnings.append(f"Pod 이름이 {POD_NAME_MAX}자를 넘어 시안 제목으로 길 수 있습니다: {', '.join(long)}")
    if len(pages.texts.get("specs/", "")) < _MIN_SPECS_TEXT:  # 없거나, 화면에서 그려져 받아도 비어 있음
        used = " · ".join(_PAGE_NAMES[sub] for sub in pages.texts if sub != "specs/")
        warnings.append(f"스펙 페이지에서 스펙 표를 읽지 못해 {used}만 보고 정리했습니다. 수치를 한 번 더 확인해 주세요.")
    return warnings


async def import_product_page(request: PageImportRequest) -> PageImportResult:
    pages = await fetch_pages(request.url)
    info_task = (
        asyncio.sleep(0, _mock_info(request, pages)) if settings.llm_provider == "mock" else _ask(request, pages)
    )
    info, images = await asyncio.gather(info_task, image_candidates(pages.image_urls))
    if request.pods:  # 지금 Pod 순서대로, 없는 이름은 버린다
        by_name = {pod.name: pod for pod in info.pods}
        pods = [by_name[name] for name in request.pods if name in by_name]
    else:
        pods = info.pods[:MAX_PODS]
    return PageImportResult(
        base_url=pages.base_url,
        product_name=info.product_name.strip(),
        colors=", ".join(dict.fromkeys(c.strip() for c in info.colors if c.strip())),
        pods=pods,
        images=images,
        warnings=_check(info.model_copy(update={"pods": pods}), pages, request),
    )
