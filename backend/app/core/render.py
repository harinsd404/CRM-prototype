from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader

from app.core.state import RunState

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates"
_env = Environment(loader=FileSystemLoader(TEMPLATE_DIR), autoescape=True)


def build_html_input(run: RunState) -> dict[str, Any]:
    """원본 P1 [8] 'HTML 합성용 JSON'과 같은 모양. 선택된 ①②③을 Pod 순서대로 묶는다."""
    copies = {p["pod"]: p for p in run.selected("copy")["pods"]}
    pods = []
    for rank, item in enumerate(run.selected("pod")["items"], 1):
        pod = item["pod"]
        copy = copies.get(pod, {})  # 모델이 Pod를 빠뜨려도 조립은 깨지지 않게 한다
        image = run.selected("image", pod)
        pods.append(
            {
                "order": rank,
                "pod": pod,
                "eyebrow": pod,
                "layout": item["layout"],
                "img": f"{run.input.target_id}_{rank}_{run.input.pod(pod).key}.png",
                "img_ratio": image["brief"]["ratio"],
                "headline": copy.get("headline", ""),
                "body": copy.get("body", ""),
                "image_url": image["image_url"],  # 미리보기용 실제 경로 (원본 JSON에는 없음)
            }
        )
    return {"target": run.input.target_id, "pods": pods}


def _backgrounds(layouts: list[str]) -> list[str]:
    """P3 규칙: L3는 검정. 나머지는 흰색이되, 흰색 Pod가 연달아 오면 두 번째를 회색으로."""
    result, previous = [], None
    for layout in layouts:
        bg = "dark" if layout == "L3" else ("gray" if previous == "white" else "white")
        result.append(bg)
        previous = bg
    return result


def render_crm(run: RunState, html_input: dict[str, Any]) -> str:
    """원본 P3(HTML 생성 프롬프트)의 디자인 토큰과 L1~L5 정의를 템플릿으로 옮긴 결정적 조립. LLM을 쓰지 않는다."""
    pods = html_input["pods"]
    backgrounds = _backgrounds([p["layout"] for p in pods])
    sections = [{**p, "bg": bg, "aspect": p["img_ratio"].replace(":", " / ")} for p, bg in zip(pods, backgrounds)]
    return _env.get_template("crm.html.j2").render(product_name=run.input.product_name, sections=sections)
