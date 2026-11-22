import asyncio
import re
from collections import Counter
from typing import Literal

from pydantic import BaseModel, Field

from app.core.domain import LAYOUT_DESCRIPTIONS, pod_rules
from app.core.state import RunState
from app.config import settings
from app.steps.base import TextStep, invoke_structured

HEADLINE_MAX = 20
BODY_MAX = 110
SHORTEN_ATTEMPTS = 2


class FactCheck(BaseModel):
    expression: str = Field(description="카피 내 표현")
    source: str = Field(description="입력 데이터 원문 구절")


class PodCopy(BaseModel):
    pod: str = Field(description="확정된 Pod 이름 그대로")
    eyebrow: str = Field(description="Pod명 그대로")
    headline: str = Field(description=f"헤드카피. 공백 포함 {HEADLINE_MAX}자 이내, 1줄")
    headline_type: Literal["a", "b", "c", "d", "e"] = Field(description="헤드카피 구조 유형")
    body: str = Field(description=f"바디카피. 2~3문장, 공백 포함 합계 {BODY_MAX}자 이내")
    ending_order: str = Field(description="바디카피 어미 배열. 예: 죠→보세요→습니다")
    target_scene: str = Field(
        default="",
        description="바디카피에 넣은 타겟 페르소나의 사용 장면 구절을 글자 그대로 (예: '등굣길 버스 안에서'). 장소·상황만",
    )
    factcheck: list[FactCheck]


class CopyOption(BaseModel):
    pods: list[PodCopy] = Field(description="확정된 Pod 순서와 같은 순서로 모든 Pod")
    rationale: str = Field(description="카피 소구 기획 의도")


class RevisedPods(BaseModel):
    pods: list[PodCopy] = Field(description="[수정할 Pod]만, 지금 카피의 순서대로")


class ShortHeadline(BaseModel):
    pod: str
    headline: str


class ShortenResult(BaseModel):
    headlines: list[ShortHeadline]


class ShortBody(BaseModel):
    pod: str
    body: str


class ShortenBodyResult(BaseModel):
    bodies: list[ShortBody]


class ToneDownPod(BaseModel):
    pod: str
    headline: str
    body: str


class ToneDownResult(BaseModel):
    pods: list[ToneDownPod]


# 스펙에 같은 말이 없으면 쓸 수 없는 표현: 최상급·무결 주장·지속 시간·성능 정도·의료 효능.
# (카피에서 찾을 정규식, 스펙에 이 중 하나가 있으면 근거가 있는 것으로 보는 어간)
# 실측: 장면을 넣자 "배터리 걱정 없이", "지연 없이", "밤늦게까지 든든하게"처럼 스펙에 없는 결과가 따라 붙었다
_CLAIMS: list[tuple[re.Pattern[str], tuple[str, ...]]] = [
    (re.compile(p), stems)
    for p, stems in [
        (r"압도적\w*", ("압도",)),
        (r"최고\w*", ("최고",)),
        (r"최강\w*", ("최강",)),
        (r"최상\w*", ("최상",)),
        (r"완벽\w*", ("완벽",)),
        (r"유일\w*", ("유일",)),
        (r"(세계\s?)?최초", ("최초",)),
        (r"가장(?!자리)", ("가장",)),
        (r"역대\w*", ("역대",)),
        (r"혁신적\w*|획기적\w*", ("혁신", "획기")),
        (r"(끊김|끊임|버벅임|버벅거림|렉|딜레이|지연|막힘)\s?(없이|없는|없고|없어|없죠)", ("끊김", "끊임", "버벅", "렉", "딜레이", "지연", "막힘")),
        (r"걱정\s?(없이|없는|없고|없어|없죠|을 덜|을 줄|이 사라)", ("걱정",)),
        (r"하루\s?종일|온종일|밤새\w*|밤늦게까지|며칠", ("종일", "밤새", "밤늦", "며칠")),
        (r"빠른|빠르게|빨라\w*|신속\w*|재빠\w*", ("빠르", "빠른", "신속", "속도")),
        (r"매끄러\w*|매끄럽\w*", ("매끄",)),
        (r"부드러\w*|부드럽\w*", ("부드",)),
        (r"쾌적\w*", ("쾌적",)),
        (r"강력\w*", ("강력",)),
        (r"정밀\w*|정확\w*|꼼꼼\w*|철저\w*", ("정밀", "정확", "꼼꼼", "철저")),
        (r"넉넉\w*|든든\w*", ("넉넉", "든든")),
        (r"진단\w*|치료\w*|예방\w*", ("진단", "치료", "예방")),
    ]
]


_NUMBER = re.compile(r"\d[\d,.]*\d|\d")


def numbers(text: str) -> set[str]:
    """글 속 수치를 표기 차이(5,000 / 5000) 없이 모은다. 부분 문자열이 아니라 수치 단위로 비교하려고 쓴다 (8 ≠ 80)."""
    return {n.replace(",", "") for n in _NUMBER.findall(text)}


def unsourced_numbers(text: str, source: str) -> list[str]:
    """카피에 쓴 수치 중 입력 원문에 없는 것. factcheck에 적지 않은 수치도 잡는다."""
    allowed = numbers(source)
    return [n for n in dict.fromkeys(_NUMBER.findall(text)) if n.replace(",", "") not in allowed]


def unsourced_claims(text: str, source: str) -> list[str]:
    """카피 속 과장·성능 표현 중 스펙(source)에 근거 어간이 없는 것."""
    allowed = _compact(source)
    found: dict[str, None] = {}
    for pattern, stems in _CLAIMS:
        if any(stem in allowed for stem in stems):
            continue
        for match in pattern.finditer(text):
            found[match.group(0).strip()] = None
    return list(found)


def _sentences(text: str) -> int:
    return len([s for s in re.split(r"[.?!]\s*", text) if s.strip()])


def _keeps_facts(old: str, new: str, sentences: bool) -> bool:
    """줄인 글이 수치·조건(…기준)을 빠뜨리지 않았는지. 바디는 2문장 이상도 유지해야 한다 (어미 배열이 깨지지 않게)."""
    if not numbers(old) <= numbers(new) or new.count("기준") < old.count("기준"):
        return False
    return not sentences or _sentences(new) >= min(2, _sentences(old))


async def _shorten(copy: CopyOption, field: str, max_length: int, prompt: str, schema: type[BaseModel], note: str) -> None:
    """글자 수는 코드가 세고, 넘긴 것만 모델에게 다시 줄이게 한다. 수치·조건을 빠뜨린 결과는 버리고,
    그래도 넘으면 경고로 남는다."""
    for _ in range(SHORTEN_ATTEMPTS):
        long = [p for p in copy.pods if len(getattr(p, field)) > max_length]
        if not long:
            return
        items = "\n".join(
            f"- {p.pod} ({getattr(p, note)}): {getattr(p, field)}  ← 현재 {len(getattr(p, field))}자"
            + (f" / 남길 타겟 장면: {p.target_scene}" if field == "body" and p.target_scene else "")
            for p in long
        )
        result = await invoke_structured(prompt, schema, {"items": items, "max_length": str(max_length)})
        returned = result.headlines if field == "headline" else result.bodies
        shortened = {item.pod: getattr(item, field).strip() for item in returned}
        for p in long:
            old = getattr(p, field)
            new = shortened.get(p.pod)
            # 바디에 있던 타겟 장면을 줄이면서 지웠으면 버린다 (페르소나 반영이 빠진다)
            scene = _compact(p.target_scene)
            keeps_scene = field != "body" or not scene or scene not in _compact(old) or scene in _compact(new)
            if new and len(new) < len(old) and keeps_scene and _keeps_facts(old, new, sentences=field == "body"):
                setattr(p, field, new)


async def tone_down_copy(copy: CopyOption, sources: dict[str, str]) -> None:
    """스펙에 근거 없는 과장·성능 표현이 있는 Pod만 모델에게 그 표현을 빼거나 스펙 표현으로 바꾸게 한다.
    수치·조건·타겟 장면을 빠뜨렸거나 표현이 줄지 않은 결과는 버리고, 남은 것은 check_copy가 경고로 남긴다."""
    flagged = {
        p.pod: claims for p in copy.pods if (claims := unsourced_claims(f"{p.headline} {p.body}", sources.get(p.pod, "")))
    }
    if not flagged:
        return
    items = "\n".join(
        f"- {p.pod}\n  헤드: {p.headline}\n  바디: {p.body}\n  근거 없는 표현: {', '.join(flagged[p.pod])}"
        f"\n  어미 배열: {p.ending_order}" + (f" / 남길 타겟 장면: {p.target_scene}" if p.target_scene else "")
        + f"\n  이 Pod 스펙: {sources.get(p.pod, '')}"
        for p in copy.pods
        if p.pod in flagged
    )
    result = await invoke_structured(
        "copy_tone_down", ToneDownResult, {"items": items, "headline_max": str(HEADLINE_MAX), "body_max": str(BODY_MAX)}
    )
    fixed = {item.pod: item for item in result.pods}
    for p in copy.pods:
        if p.pod not in flagged or not (new := fixed.get(p.pod)):
            continue
        headline, body = new.headline.strip(), new.body.strip()
        source = sources.get(p.pod, "")
        scene = _compact(p.target_scene)
        if (
            headline
            and body
            and len(unsourced_claims(f"{headline} {body}", source)) < len(flagged[p.pod])
            and _keeps_facts(p.headline, headline, sentences=False)
            and _keeps_facts(p.body, body, sentences=True)
            and (not scene or scene not in _compact(p.body) or scene in _compact(body))
            and len(headline) <= max(HEADLINE_MAX, len(p.headline))
            and len(body) <= max(BODY_MAX, len(p.body))
        ):
            p.headline, p.body = headline, body


async def polish_copy(copy: CopyOption, sources: dict[str, str]) -> None:
    """생성·수정한 카피를 코드 규칙에 맞춘다: 과장 표현을 먼저 걷어낸 뒤(글이 길어질 수 있음) 글자 수를 줄인다."""
    await tone_down_copy(copy, sources)
    await shorten_copy(copy)


async def shorten_copy(copy: CopyOption) -> None:
    """헤드카피(20자)와 바디카피(110자, 실측: 15개 중 8개가 넘음)를 따로 줄인다. 서로 다른 칸이라 동시에 돌린다."""
    await asyncio.gather(
        _shorten(copy, "headline", HEADLINE_MAX, "copy_shorten", ShortenResult, "headline_type"),
        _shorten(copy, "body", BODY_MAX, "copy_shorten_body", ShortenBodyResult, "ending_order"),
    )


def _compact(text: str) -> str:
    """원문 대조용: 공백과 ®·™ 표기 차이는 무시한다 (모델이 공식 표기에 ®를 붙이곤 함)."""
    return "".join(text.split()).replace("®", "").replace("™", "")


def check_copy(copy: CopyOption, plan_pods: list[str], sources: dict[str, str]) -> list[str]:
    """원본 P1의 Writing Rules와 [7] 자가 점검을 코드로 검사한다.
    sources: Pod별로 인용해도 되는 입력 원문 (그 Pod의 스펙 + 제품명 + 컬러)."""
    warnings = []
    pods = [p.pod for p in copy.pods]
    if pods != plan_pods:
        warnings.append(f"Pod 순서가 ①에서 고른 순서와 다릅니다: {', '.join(pods)}")

    for p in copy.pods:
        p.eyebrow = p.pod  # eyebrow는 Pod명 그대로 (확정 규칙이라 코드로 고친다)
        if len(p.headline) > HEADLINE_MAX:
            warnings.append(f"[{p.pod}] 헤드카피 {len(p.headline)}자 (최대 {HEADLINE_MAX}자)")
        if len(p.body) > BODY_MAX:
            warnings.append(f"[{p.pod}] 바디카피 {len(p.body)}자 (최대 {BODY_MAX}자)")
        allowed = _compact(sources.get(p.pod, ""))
        if unsourced := [f.source for f in p.factcheck if _compact(f.source) not in allowed]:
            warnings.append(f"[{p.pod}] 입력 스펙에 없는 근거: {', '.join(unsourced)}")
        if numbers := unsourced_numbers(f"{p.headline} {p.body}", sources.get(p.pod, "")):
            warnings.append(f"[{p.pod}] 입력 스펙에 없는 수치: {', '.join(numbers)}")
        if claims := unsourced_claims(f"{p.headline} {p.body}", sources.get(p.pod, "")):
            warnings.append(f"[{p.pod}] 스펙에 근거 없는 과장·성능 표현: {', '.join(claims)}")
        if not p.target_scene.strip() or _compact(p.target_scene) not in _compact(p.body):
            warnings.append(f"[{p.pod}] 바디카피에 타겟 사용 장면이 없습니다")

    rules = pod_rules(len(plan_pods))
    types = Counter(p.headline_type for p in copy.pods)
    if len(types) < rules.min_headline_types:
        warnings.append(f"헤드카피 구조 유형을 {len(types)}종만 썼습니다 (최소 {rules.min_headline_types}종).")
    if overused := [t for t, n in types.items() if n > rules.max_same_headline_type]:
        warnings.append(f"같은 헤드카피 유형을 {rules.max_same_headline_type}회 넘게 썼습니다: {', '.join(overused)}")
    return warnings


def copy_sources(run: RunState) -> dict[str, str]:
    """Pod별로 카피가 인용해도 되는 입력 원문 (그 Pod의 스펙 + 제품명 + 컬러)."""
    return {pod.name: f"{pod.spec} {run.input.product_name} {' '.join(run.input.color_list)}" for pod in run.input.pods}


def copy_rule_vars(run: RunState) -> dict[str, str]:
    """카피 프롬프트의 Pod 수 관련 변수. 최소 개수는 Pod 수에 비례한다 (pod_rules)."""
    rules = pod_rules(len(run.input.pods))
    return {
        "pod_count": str(rules.count),
        "pod_list": " / ".join(run.input.pod_names),
        "min_headline_types": str(rules.min_headline_types),
        "max_same_headline_type": str(rules.max_same_headline_type),
        "min_fact_first": str(min(2, rules.count)),
        "official_terms": run.input.product_profile.copy_terms.strip() or "입력 데이터에 나온 기능명",
        "copy_guide": run.input.product_profile.guide("copy"),
    }


_MOCK_ENDINGS = ["습니다→죠→보세요", "죠→보세요→습니다", "보세요→습니다→죠", "습니다→보세요→죠", "죠→습니다→보세요"]
_MOCK_TYPES: list[Literal["a", "b", "c", "d", "e"]] = ["a", "b", "c", "d", "e"]


class CopyStep(TextStep):
    name = "copy"
    schema = CopyOption
    prompt_name = "copy"
    angles = [
        "기능명과 수치를 앞세우는 직설적인 카피",
        "타겟의 사용 장면을 그리는 카피",
        "고객 효익을 짧고 선명하게 정리하는 카피",
    ]

    def _plan(self, run: RunState) -> list[dict]:
        return run.selected("pod")["items"]

    def build_context(self, run: RunState, slot: str) -> dict[str, str]:
        plan = "\n".join(
            f"{rank}. {item['pod']} — {item['layout']} ({LAYOUT_DESCRIPTIONS[item['layout']]})"
            for rank, item in enumerate(self._plan(run), 1)
        )
        return {"input_data": run.input.format(), "pod_plan": plan, **copy_rule_vars(run)}

    def check_output(self, run: RunState, slot: str, content: CopyOption) -> None:
        allowed = [item["pod"] for item in self._plan(run)]
        if unknown := [p.pod for p in content.pods if p.pod not in allowed]:
            raise ValueError(f"확정된 Pod 순서에 없는 Pod 이름: {', '.join(unknown)}")

    async def generate_option(
        self, run: RunState, slot: str, context: dict[str, str], angle: str, index: int
    ) -> CopyOption:
        copy = await super().generate_option(run, slot, context, angle, index)
        if settings.llm_provider != "mock":
            await polish_copy(copy, copy_sources(run))
        return copy

    async def revise_pods(self, run: RunState, copy: CopyOption, pods: list[str], request: str) -> CopyOption:
        """고른 카피안에서 지정한 Pod들만 사람의 요청대로 다시 쓴다 (전체 선택도 가능). 나머지 Pod는 그대로 둔다.
        여러 Pod를 한 번에 맡겨야 고친 Pod끼리 헤드카피 유형·어미 배열이 겹치지 않는다."""
        targets = [p for p in copy.pods if p.pod in pods]
        if settings.llm_provider == "mock":
            revised = {p.pod: p.model_copy(update={"headline": f"[수정] {p.headline}"[:HEADLINE_MAX]}) for p in targets}
        else:
            current = "\n".join(
                f"- {p.pod} ({p.headline_type} · {p.ending_order}) 헤드: {p.headline} / 바디: {p.body}" for p in copy.pods
            )
            result = await invoke_structured(
                "copy_revise",
                RevisedPods,
                {
                    "input_data": run.input.format(),
                    "current_copy": current,
                    "pods": ", ".join(p.pod for p in targets),
                    "request": request,
                    **copy_rule_vars(run),
                    "headline_max": str(HEADLINE_MAX),
                    "body_max": str(BODY_MAX),
                },
            )
            revised = {p.pod: p for p in result.pods if p.pod in pods}
            missing = [p.pod for p in targets if p.pod not in revised]
            if missing:
                raise ValueError(f"모델이 일부 Pod를 돌려주지 않았습니다: {', '.join(missing)}")
            partial = CopyOption(pods=list(revised.values()), rationale="")
            await polish_copy(partial, copy_sources(run))
            revised = {p.pod: p for p in partial.pods}
        return copy.model_copy(update={"pods": [revised.get(p.pod, p) for p in copy.pods]})

    def postprocess(self, run: RunState, slot: str, content: CopyOption) -> list[str]:
        return check_copy(content, [item["pod"] for item in self._plan(run)], copy_sources(run))

    def mock_option(self, run: RunState, slot: str, angle: str, index: int) -> CopyOption:
        pods = []
        for i, item in enumerate(self._plan(run)):
            spec = run.input.pod(item["pod"]).spec.strip() or "(입력 데이터 없음)"
            pods.append(
                PodCopy(
                    pod=item["pod"],
                    eyebrow=item["pod"],
                    headline=f"[예시{index + 1}] {item['pod']} 헤드카피",
                    headline_type=_MOCK_TYPES[(i + index) % 5],
                    body=f"{spec[:40]}. 실제 생성에서는 이 자리에 바디카피가 들어갑니다.",
                    ending_order=_MOCK_ENDINGS[(i + index) % 5],
                    target_scene="실제 생성",
                    factcheck=[FactCheck(expression=spec[:20], source=spec[:20])],
                )
            )
        return CopyOption(pods=pods, rationale=f"[예시] '{angle}' 방향의 카피입니다.")
