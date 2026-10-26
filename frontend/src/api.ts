import type { RunInput, RunState, StepContents, StepName } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    // FastAPI 입력 검증 오류(422)는 detail이 배열이다
    const message = Array.isArray(detail) ? detail.map((d) => d.msg).join(", ") : detail;
    throw new Error(typeof message === "string" ? message : `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  createRun: (input: RunInput) =>
    request<RunState>("/runs", { method: "POST", body: JSON.stringify(input) }),

  getRun: (runId: string) => request<RunState>(`/runs/${runId}`),

  // slot을 주면 그 슬롯(이미지 단계의 Pod 하나)만 다시 생성한다. feedback은 모든 안에 반영할 사람의 수정 요청
  generate: (runId: string, step: StepName, slot?: string, feedback?: string) =>
    request<RunState>(
      `/runs/${runId}/steps/${step}/generate${slot ? `?slot=${encodeURIComponent(slot)}` : ""}`,
      { method: "POST", body: JSON.stringify({ feedback: feedback ?? null }) },
    ),

  // 고른 안의 일부를 요청대로 고친다. 이미지: 그 이미지를 고친 새 안 추가 / 카피: pod 하나만 다시 쓰기
  revise: (runId: string, step: StepName, body: { slot: string; index: number; request: string; pod?: string }) =>
    request<RunState>(`/runs/${runId}/steps/${step}/revise`, { method: "POST", body: JSON.stringify(body) }),

  // edited의 형식은 백엔드가 단계별 스키마로 검증한다 (틀리면 422)
  select: (runId: string, step: StepName, slot: string, index: number, edited?: StepContents[StepName]) =>
    request<RunState>(`/runs/${runId}/steps/${step}/select`, {
      method: "POST",
      body: JSON.stringify({ slot, index, edited: edited ?? null }),
    }),

  render: (runId: string) => request<RunState>(`/runs/${runId}/render`, { method: "POST" }),

  // 최종 시안 ZIP (index.html + images/ + fonts/ + html_input.json)
  downloadUrl: (run: RunState) => `/api/runs/${run.id}/download?v=${encodeURIComponent(run.updated_at)}`,

  previewUrl: (run: RunState) => `/api/runs/${run.id}/preview?v=${encodeURIComponent(run.updated_at)}`,
};
