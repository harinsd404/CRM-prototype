import { useEffect, useState } from "react";
import { api } from "../api";
import type { RunInput, RunSummary } from "../types";
import { Spinner } from "./icons";

interface Props {
  onOpen: (runId: string) => void; // 이어서 만들기
  onNew: (input: RunInput | null) => void; // 새로 만들기 (input을 주면 그 입력을 채워 둔다)
}

const STAGES = ["Pod 순서", "카피", "이미지", "시안 조립"];

function progress(run: RunSummary) {
  const done = run.completed_steps.length + (run.has_html ? 1 : 0);
  return { done, label: done === STAGES.length ? "완성" : `${STAGES[done]} 단계` };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 내가 만든 실행 목록. 눌러서 이어서 만들거나, 같은 입력으로 (페르소나만 바꿔) 새로 만들 수 있다. */
export default function RunList({ onOpen, onNew }: Props) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listRuns().then(setRuns, (e: Error) => setError(e.message));
  }, []);

  return (
    <section className="rounded-xl border bg-white p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-semibold">내 작업</h2>
        <button
          onClick={() => onNew(null)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover active:bg-primary-pressed"
        >
          새로 만들기
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      {runs === null && !error && (
        <div className="flex justify-center py-10">
          <Spinner className="h-5 w-5 text-gray-400" />
        </div>
      )}
      {runs?.length === 0 && <p className="py-10 text-center text-sm text-gray-500">아직 만든 시안이 없습니다.</p>}

      {runs && runs.length > 0 && (
        <ul className="mt-4 divide-y">
          {runs.map((run) => {
            const { done, label } = progress(run);
            return (
              <li key={run.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <button onClick={() => onOpen(run.id)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium hover:text-primary">
                    <span className="mr-1.5 text-gray-500">{run.target_id}</span>
                    {run.persona}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {run.product_name} · {run.mood} · 수정 {formatDate(run.updated_at)}
                  </p>
                </button>
                <div className="flex items-center gap-2" title={label}>
                  <div className="flex gap-0.5">
                    {STAGES.map((stage, i) => (
                      <span key={stage} className={`h-1.5 w-5 rounded-full ${i < done ? "bg-primary" : "bg-gray-250"}`} />
                    ))}
                  </div>
                  <span className={`w-20 text-xs ${done === STAGES.length ? "font-medium text-primary" : "text-gray-500"}`}>
                    {label}
                  </span>
                </div>
                <div className="flex gap-3 text-sm">
                  <button onClick={() => onOpen(run.id)} className="text-primary hover:underline">
                    이어서 만들기
                  </button>
                  <button
                    onClick={() => onNew({ ...run.input, persona: "" })}
                    title="제품 정보·Pod 스펙·사진은 그대로 두고 페르소나만 새로 적습니다"
                    className="text-gray-500 hover:text-gray-900"
                  >
                    다른 페르소나로
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
