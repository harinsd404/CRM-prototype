// backend/app/core/state.py, backend/app/core/domain.py, backend/app/steps/*.py 의 모델과 맞춘다.

export type StepName = "pod" | "copy" | "image";

export const STEP_ORDER: StepName[] = ["pod", "copy", "image"];

export const STEP_LABELS: Record<StepName, string> = {
  pod: "① Pod 순서 · 레이아웃",
  copy: "② 카피",
  image: "③ 이미지",
};

// POD·카피 단계의 슬롯. 이미지 단계는 Pod 이름이 슬롯이다.
export const MAIN_SLOT = "main";

export type PodName = "디자인" | "디스플레이" | "성능" | "카메라" | "Now nudge";
export const POD_NAMES: PodName[] = ["디자인", "디스플레이", "성능", "카메라", "Now nudge"];

export type Layout = "L1" | "L2" | "L3" | "L4" | "L5";
export const LAYOUTS: Layout[] = ["L1", "L2", "L3", "L4", "L5"];
// backend/app/core/domain.py LAYOUT_DESCRIPTIONS의 짧은 버전
export const LAYOUT_LABELS: Record<Layout, string> = {
  L1: "텍스트 위 · 풀폭 이미지",
  L2: "풀폭 이미지 · 텍스트 아래",
  L3: "풀블리드 + 텍스트 오버레이",
  L4: "둥근 이미지 카드",
  L5: "좌 텍스트 · 우 이미지",
};
export type Mood = "HOT" | "WARM" | "COLD";

export interface PodContent {
  target_summary: string;
  items: { pod: PodName; layout: Layout; reason: string }[];
  rationale: string;
}

export interface CopyContent {
  pods: {
    pod: PodName;
    eyebrow: string;
    headline: string;
    headline_type: "a" | "b" | "c" | "d" | "e";
    body: string;
    ending_order: string;
    factcheck: { expression: string; source: string }[];
  }[];
  rationale: string;
}

export interface ImageBrief {
  concept: string;
  image_type: string;
  color: string;
  state: string;
  view: string;
  scene: string;
  props: string;
  screen_content: string;
  person_hand: string;
  face: string;
  composition: string;
  ratio: "1:1" | "4:3" | "16:9";
  safe_zone: string;
}

export interface ImageContent {
  brief: ImageBrief;
  prompt: string;
  image_url: string;
}

export interface StepContents {
  pod: PodContent;
  copy: CopyContent;
  image: ImageContent;
}

export interface Option<S extends StepName> {
  angle: string;
  content: StepContents[S];
  warnings: string[];
}

export interface SlotState<S extends StepName> {
  options: Option<S>[];
  selected: number | null;
  edited: Option<S> | null;
}

export interface StepState<S extends StepName> {
  slots: Record<string, SlotState<S>>;
}

export interface RunInput {
  target_id: string;
  persona: string;
  mood: Mood;
  used_first_pod: PodName | null;
  product_name: string;
  colors: string;
  specs: Record<PodName, string>;
}

export interface RunState {
  id: string;
  created_at: string;
  updated_at: string;
  input: RunInput;
  steps: { [S in StepName]: StepState<S> };
  html: string | null;
}

export function isStepComplete(step: StepState<StepName>): boolean {
  const slots = Object.values(step.slots);
  return slots.length > 0 && slots.every((slot) => slot.selected !== null);
}
