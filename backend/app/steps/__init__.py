from app.core.state import STEP_ORDER
from app.steps.base import Step
from app.steps.copy import CopyStep
from app.steps.image import ImageStep
from app.steps.pod import PodStep

STEPS: dict[str, Step] = {step.name: step for step in (PodStep(), CopyStep(), ImageStep())}

assert tuple(STEPS) == STEP_ORDER, "STEPS 등록 순서는 STEP_ORDER와 같아야 한다"
