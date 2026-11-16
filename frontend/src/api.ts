import type {
  Feedback,
  FeedbackFilter,
  FeedbackStatus,
  FeedbackStep,
  ImageCheck,
  Me,
  ProductImage,
  ProductProfile,
  ProfileResult,
  RunInput,
  RunState,
  RunSummary,
  StepContents,
  StepName,
  Template,
  TemplateSummary,
} from "./types";

// 배포 경로(예: /park) 아래에서 열릴 때를 위해 /api 주소 앞에 붙인다. 로컬 개발은 빈 문자열
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** 서버가 준 /api/... 주소(이미지·업로드 등)에 배포 경로를 붙인다 */
export function withBase<T extends string | null | undefined>(url: T): T {
  return (typeof url === "string" && url.startsWith("/api/") ? `${BASE}${url}` : url) as T;
}

// 로그인이 풀리면(401) 화면이 로그인 창으로 돌아가도록 App이 등록한다
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized();
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    // FastAPI 입력 검증 오류(422)는 detail이 배열이다
    const message = Array.isArray(detail) ? detail.map((d) => d.msg).join(", ") : detail;
    throw new Error(typeof message === "string" ? message : `${res.status} ${res.statusText}`);
  }
  return res.json();
}

function feedbackQuery(filter: FeedbackFilter) {
  const params = new URLSearchParams();
  if (filter.template === "none") params.set("no_template", "true");
  else if (filter.template != null) params.set("template_id", String(filter.template));
  if (filter.status) params.set("status", filter.status);
  if (filter.source) params.set("source", filter.source);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const api = {
  login: (username: string, password: string) =>
    request<Me>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),

  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  me: () => request<Me>("/auth/me"),

  // 내 실행 목록 (최근에 고친 순서)
  listRuns: () => request<RunSummary[]>("/runs"),

  createRun: (input: RunInput) =>
    request<RunState>("/runs", { method: "POST", body: JSON.stringify(input) }),

  getRun: (runId: string) => request<RunState>(`/runs/${runId}`),

  // 제품 템플릿 (모두가 함께 쓴다)
  listTemplates: () => request<TemplateSummary[]>("/templates"),
  getTemplate: (id: number) => request<Template>(`/templates/${id}`),

  // 실행의 제품명·컬러·Pod·제품 사진을 템플릿으로 저장. template_id를 주면 덮어쓴다
  saveRunAsTemplate: (runId: string, body: { template_id: number | null; name: string | null }) =>
    request<Template>(`/runs/${runId}/template`, { method: "POST", body: JSON.stringify(body) }),

  // 피드백: 실행에서 남기기·보기, 템플릿별 모아 보기(모든 사용자), 상태 바꾸기, CSV
  addFeedback: (runId: string, body: { step: FeedbackStep; pod: string | null; content: string }) =>
    request<Feedback>(`/runs/${runId}/feedback`, { method: "POST", body: JSON.stringify(body) }),
  runFeedback: (runId: string) => request<Feedback[]>(`/runs/${runId}/feedback`),
  listFeedback: (filter: FeedbackFilter) => request<Feedback[]>(`/feedback${feedbackQuery(filter)}`),
  setFeedbackStatus: (id: number, status: FeedbackStatus) =>
    request<{ ok: boolean }>(`/feedback/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  deleteFeedback: (id: number) => request<{ ok: boolean }>(`/feedback/${id}`, { method: "DELETE" }),
  feedbackCsvUrl: (filter: FeedbackFilter) => `${BASE}/api/feedback/export${feedbackQuery(filter)}`,

  // 고른 제품 사진의 해상도·장 수·필수 자리 검사 (경고만). profile이 null이면 Fold 기본 프로필
  checkProductImages: (
    product_images: RunInput["product_images"],
    extra_product_images: string[],
    profile: ProductProfile | null,
  ) =>
    request<ImageCheck>("/product-images/check", {
      method: "POST",
      body: JSON.stringify({ product_images, extra_product_images, profile }),
    }),

  // 제품 프로필: 기본(Fold), 올린 사진으로 AI 생성
  defaultProfile: () => request<ProductProfile>("/profiles/default"),
  generateProfile: (body: {
    product_name: string;
    colors: string;
    pods: { name: string; spec: string }[];
    images: string[];
  }) => request<ProfileResult>("/profiles/generate", { method: "POST", body: JSON.stringify(body) }),

  // 입력 화면의 공식 제품 사진 5자리와 기본 사진
  getProductImages: () => request<ProductImage[]>("/product-images"),

  // 사진 파일을 body 그대로 보낸다. 받은 name을 RunInput.product_images에 넣는다
  upload: (file: File) =>
    request<{ name: string; url: string }>("/uploads", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    }),

  // slot을 주면 그 슬롯(이미지 단계의 Pod 하나)만 다시 생성한다. feedback은 모든 안에 반영할 사람의 수정 요청
  generate: (runId: string, step: StepName, slot?: string, feedback?: string) =>
    request<RunState>(
      `/runs/${runId}/steps/${step}/generate${slot ? `?slot=${encodeURIComponent(slot)}` : ""}`,
      { method: "POST", body: JSON.stringify({ feedback: feedback ?? null }) },
    ),

  // 고른 안의 일부를 요청대로 고친다. 이미지: 그 이미지를 고친 새 안 추가 / 카피: pods에 적은 Pod만(전체 가능) 다시 쓰기
  revise: (runId: string, step: StepName, body: { slot: string; index: number; request: string; pods?: string[] }) =>
    request<RunState>(`/runs/${runId}/steps/${step}/revise`, { method: "POST", body: JSON.stringify(body) }),

  // edited의 형식은 백엔드가 단계별 스키마로 검증한다 (틀리면 422)
  select: (runId: string, step: StepName, slot: string, index: number, edited?: StepContents[StepName]) =>
    request<RunState>(`/runs/${runId}/steps/${step}/select`, {
      method: "POST",
      body: JSON.stringify({ slot, index, edited: edited ?? null }),
    }),

  // 앞 단계가 바뀌었다는 표시를 지우고 지금 이미지를 그대로 쓴다
  keepImage: (runId: string, slot: string) =>
    request<RunState>(`/runs/${runId}/steps/image/slots/${encodeURIComponent(slot)}/keep`, { method: "POST" }),

  render: (runId: string) => request<RunState>(`/runs/${runId}/render`, { method: "POST" }),

  // 최종 시안 ZIP (index.html + images/ + fonts/ + html_input.json)
  downloadUrl: (run: RunState) => `${BASE}/api/runs/${run.id}/download?v=${encodeURIComponent(run.updated_at)}`,

  previewUrl: (run: RunState) => `${BASE}/api/runs/${run.id}/preview?v=${encodeURIComponent(run.updated_at)}`,
};
