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


async def shorten_headlines(copy: CopyOption) -> None:
    """글자 수는 코드가 세고, 넘긴 헤드카피만 모델에게 다시 줄이게 한다. 그래도 넘으면 경고로 남는다."""
    for _ in range(SHORTEN_ATTEMPTS):
        long = [p for p in copy.pods if len(p.headline) > HEADLINE_MAX]
        if not long:
            return
        items = "\n".join(f"- {p.pod} ({p.headline_type}): {p.headline}  ← 현재 {len(p.headline)}자" for p in long)
        result = await invoke_structured("copy_shorten", ShortenResult, {"items": items, "max_length": str(HEADLINE_MAX)})
        shortened = {h.pod: h.headline.strip() for h in result.headlines}
        for p in long:
            if (new := shortened.get(p.pod)) and len(new) < len(p.headline):
                p.headline = new


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

    rules = pod_rules(len(plan_pods))
    types = Counter(p.headline_type for p in copy.pods)
    if len(types) < rules.min_headline_types:
        warnings.append(f"헤드카피 구조 유형을 {len(types)}종만 썼습니다 (최소 {rules.min_headline_types}종).")
    if overused := [t for t, n in types.items() if n > rules.max_same_headline_type]:
        warnings.append(f"같은 헤드카피 유형을 {rules.max_same_headline_type}회 넘게 썼습니다: {', '.join(overused)}")
    endings = [p.ending_order.replace(" ", "") for p in copy.pods]
    if len(set(endings)) < len(endings):
        warnings.append("어미 배열이 같은 Pod가 있습니다.")
    return warnings


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
            await shorten_headlines(copy)
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
            await shorten_headlines(partial)
            revised = {p.pod: p for p in partial.pods}
        return copy.model_copy(update={"pods": [revised.get(p.pod, p) for p in copy.pods]})

    def postprocess(self, run: RunState, slot: str, content: CopyOption) -> list[str]:
        sources = {pod.name: f"{pod.spec} {run.input.product_name} {run.input.colors}" for pod in run.input.pods}
        return check_copy(content, [item["pod"] for item in self._plan(run)], sources)

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
                    factcheck=[FactCheck(expression=spec[:20], source=spec[:20])],
                )
            )
        return CopyOption(pods=pods, rationale=f"[예시] '{angle}' 방향의 카피입니다.")
