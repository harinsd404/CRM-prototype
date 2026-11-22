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

// Pod는 템플릿마다 다르다 (예: Fold는 디자인·디스플레이·성능·카메라·Now nudge). 이름이 곧 슬롯 이름이다
export type PodName = string;
// backend/app/core/domain.py MAX_PODS와 맞춘다
export const MAX_PODS = 10;

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
// 소구 강도. 원본 P1 입력 양식에서는 "무드"로 적혀 있다
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
  orientation?: "portrait" | "landscape";
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
  pending: number; // 아직 만드는 중인 안의 수 (이미지는 한 장씩 끝나는 대로 options에 붙는다)
  stale: string[]; // 이 안들을 만든 뒤 앞 단계에서 바뀐 점 (이미지 단계). 다시 생성하면 비워진다
}

export interface StepState<S extends StepName> {
  slots: Record<string, SlotState<S>>;
}

/** 이번 실행에 쓰는 Pod 하나 (backend/app/core/state.py PodInput) */
export interface PodInput {
  name: string;
  key: string; // 영문 이름 (HTML 합성용 이미지 파일명). 비우면 서버가 pod1, pod2 …로 채운다
  spec: string;
  visual: string; // 이미지 기본 연출 방향
}

export interface RunInput {
  template_id: number | null; // 불러온 템플릿 (없으면 직접 입력)
  target_id: string;
  persona: string;
  mood: Mood;
  product_name: string;
  colors: string;
  pods: PodInput[]; // 기본 순서대로
  // 공식 제품 사진을 바꾸거나 지운 자리만 적는다. 없는 자리 = 기본 사진, null = 지움, 문자열 = 올린 파일 이름
  product_images?: Partial<Record<string, string | null>>;
  // 사진 자리 외에 더 올린 제품 사진 파일 이름 (최대 MAX_EXTRA_PRODUCT_IMAGES장)
  extra_product_images?: string[];
  // 제품 프로필(프롬프트의 제품별 블록). null이면 서버가 Galaxy Z Fold 기본 프로필을 쓴다
  profile?: ProductProfile | null;
  // 불러온 템플릿 프로필의 버전. 실행을 그 템플릿에 덮어쓸 때 그 사이 규칙이 바뀌었는지 서버가 본다
  profile_version?: number | null;
}

/** 제품 프로필 = 프롬프트의 제품별 블록 (backend/app/core/profile.py). 사진 자리와 제품 상태를 정한다 */
export interface PhotoSlot {
  key: string;
  label: string;
  caption: string; // 이미지 모델에 사진과 함께 보내는 영어 설명
  required: boolean;
}

export interface ProductState {
  key: string;
  label: string;
  brief_hint: string;
  rules: string;
  shows_screen: boolean;
  orientation: "portrait" | "landscape" | "any";
  photos: string[]; // 사진 자리 key, 첫 번째가 주 참조
}

export interface ProductProfile {
  device_noun: string;
  device_rules: string;
  screen_rules: string;
  usage: string; // 사람이 제품을 쓰는 방식 (한국어, 연출안용)
  person_rules: string; // 손·인물이 나올 때 이미지 모델 규칙 (영어)
  check: string;
  edit_rules: string;
  photo_slots: PhotoSlot[];
  states: ProductState[];
  reference_color: string;
  color_slot: string | null;
  copy_terms: string;
  // 제품별 가이드 (한국어): ① Pod 기획 / ② 카피 / ③ 연출안 프롬프트 끝에 붙는다
  pod_guide: string;
  copy_guide: string;
  visual_guide: string;
}

/** 템플릿의 제품 프로필 버전 (backend/app/core/templates.py ProfileVersionOut) */
export interface ProfileVersion {
  version: number;
  status: "active" | "archived" | "proposed" | "rejected";
  source: "seed" | "ai" | "manual" | "feedback" | "run";
  note: string;
  feedback_ids: number[];
  base_version: number | null; // 개선안: 만들 때 쓰던 버전
  created_by: string | null;
  created_at: string;
  profile: ProductProfile;
}

/** POST /api/profiles/generate: 올린 사진으로 AI가 만든 프로필과 사진 배정 */
export interface ProfileResult {
  profile: ProductProfile;
  product_images: Record<string, string>;
  extra_product_images: string[];
  pod_visuals: Record<string, string>;
  warnings: string[];
}

/** POST /api/product-images/check (backend/app/core/image_check.py) */
export interface ImageCheck {
  images: Record<string, { width: number; height: number; warning: string | null }>; // 자리 또는 추가 사진 파일 이름
  warnings: string[];
}

// backend/app/core/domain.py MAX_EXTRA_PRODUCT_IMAGES와 맞춘다
export const MAX_EXTRA_PRODUCT_IMAGES = 5;

export interface Me {
  username: string;
}

/** 내 작업 목록의 한 줄 (backend/app/api/runs.py RunSummary) */
export interface RunSummary {
  id: string;
  created_at: string;
  updated_at: string;
  target_id: string;
  persona: string;
  mood: Mood;
  product_name: string;
  completed_steps: StepName[];
  has_html: boolean;
  input: RunInput;
}

/** 템플릿의 Pod. enabled = 새 실행에서 기본으로 켜 둘지 (backend/app/core/templates.py) */
export interface TemplatePod extends PodInput {
  enabled: boolean;
}

/** 제품 템플릿. 모든 사용자가 함께 쓴다 */
export interface Template {
  id: number;
  name: string;
  product_name: string;
  colors: string;
  pods: TemplatePod[];
  // 기본 이미지. 있는 자리만 적혀 있다 (없는 자리 = 사진 없음). 값은 올린 파일 이름
  product_images: Record<string, string>;
  extra_product_images: string[];
  profile: ProductProfile | null; // 지금 쓰는 버전 (없으면 Fold 기본 프로필)
  profile_version: number | null;
  updated_at: string;
  updated_by: string | null;
}

export interface TemplateSummary {
  id: number;
  name: string;
  product_name: string;
  pod_count: number;
  updated_at: string;
  updated_by: string | null;
}

// GET /api/product-images (backend/app/api/product_images.py)
export interface ProductImage {
  role: string;
  label: string;
  default_url: string | null;
}

export interface RunState {
  id: string;
  created_at: string;
  updated_at: string;
  input: RunInput;
  steps: { [S in StepName]: StepState<S> };
  html: string | null;
}

/** ①에서 고른(또는 고친) Pod 순서. 아직 고르지 않았으면 빈 목록. */
export function selectedPodOrder(run: RunState): PodName[] {
  const pod = run.steps.pod.slots[MAIN_SLOT];
  const option = pod?.selected != null ? (pod.edited ?? pod.options[pod.selected]) : null;
  return option ? option.content.items.map((item) => item.pod) : [];
}

/** backend RunState.is_complete와 같은 기준: 모든 슬롯을 골랐고, 이미지는 모든 Pod가 있어야 한다. */
export function isStepComplete(run: RunState, step: StepName): boolean {
  const slots = run.steps[step].slots;
  const values = Object.values(slots);
  const allSelected = values.length > 0 && values.every((slot) => slot.selected !== null);
  if (step === "image") return allSelected && selectedPodOrder(run).every((pod) => pod in slots);
  return allSelected;
}

/** 피드백 (backend/app/core/feedback.py). 템플릿별로 모인다 */
export type FeedbackStep = "pod" | "copy" | "image" | "result";
export type FeedbackSource = "manual" | "regenerate" | "revise";
export type FeedbackStatus = "open" | "applied" | "dismissed";

export const FEEDBACK_STEP_LABELS: Record<FeedbackStep, string> = {
  pod: "① Pod 순서",
  copy: "② 카피",
  image: "③ 이미지",
  result: "④ 최종 시안",
};
export const FEEDBACK_SOURCE_LABELS: Record<FeedbackSource, string> = {
  manual: "직접 남김",
  regenerate: "다시 생성 요청",
  revise: "수정 요청",
};
export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: "확인 전",
  applied: "반영함",
  dismissed: "보류",
};

export interface Feedback {
  id: number;
  template_id: number | null;
  template_name: string | null;
  run_id: string;
  persona: string;
  username: string;
  step: FeedbackStep;
  pod: string | null;
  content: string;
  context: string; // 피드백을 남길 때 선택돼 있던 결과
  source: FeedbackSource;
  status: FeedbackStatus;
  created_at: string;
  mine: boolean;
}

/** 피드백 목록 조건. template = 템플릿 id, "none" = 템플릿 없음, null = 전체 */
export interface FeedbackFilter {
  template: number | "none" | null;
  status: FeedbackStatus | null;
  source: FeedbackSource | null;
}
