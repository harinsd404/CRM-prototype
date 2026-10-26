import { useState } from "react";
import { api } from "../api";
import { STEP_ORDER, isStepComplete, type RunState } from "../types";

interface Props {
  run: RunState;
  onChange: (run: RunState) => void;
}

/** ④ 최종 시안: 선택된 결과를 템플릿으로 조립하고 iframe으로 미리 본다. */
export default function HtmlPreview({ run, onChange }: Props) {
  const ready = STEP_ORDER.every((step) => isStepComplete(run.steps[step]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const render = async () => {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.render(run.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`rounded-xl border bg-white p-6 ${ready ? "" : "opacity-50"}`}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">④ 최종 CRM 시안</h2>
        <div className="flex items-center gap-3">
          {run.html && (
            <a href={api.previewUrl(run)} target="_blank" rel="noreferrer" className="text-sm text-gray-500 underline">
              새 탭에서 열기
            </a>
          )}
          <button
            onClick={render}
            disabled={!ready || busy}
            className="rounded-lg bg-primary hover:bg-primary-hover active:bg-primary-pressed px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "조립 중…" : run.html ? "다시 조립" : "시안 조립"}
          </button>
        </div>
      </div>

      {!ready && <p className="mt-3 text-sm text-gray-500">①~③ 단계(이미지는 Pod 5개 모두)에서 선택하면 조립할 수 있습니다.</p>}
      {error && <p className="mt-3 rounded bg-danger-soft p-3 text-sm text-danger-strong">{error}</p>}

      {run.html && (
        // 시안은 폭 1440px 고정 페이지라 가로 스크롤로 본다
        <div className="mt-5 overflow-x-auto rounded-lg border">
          <iframe title="CRM 시안 미리보기" src={api.previewUrl(run)} className="block h-[900px] w-[1440px]" />
        </div>
      )}
    </section>
  );
}
