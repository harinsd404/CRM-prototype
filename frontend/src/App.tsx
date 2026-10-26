import { useEffect, useState } from "react";
import { api } from "./api";
import HtmlPreview from "./components/HtmlPreview";
import InputForm from "./components/InputForm";
import StepPanel from "./components/StepPanel";
import { STEP_ORDER, isStepComplete, type RunState } from "./types";

// 새로고침해도 이어서 작업할 수 있게 run id를 URL(?run=)에 둔다.
function readRunId() {
  return new URLSearchParams(window.location.search).get("run");
}

function writeRunId(runId: string | null) {
  const url = new URL(window.location.href);
  if (runId) url.searchParams.set("run", runId);
  else url.searchParams.delete("run");
  window.history.replaceState(null, "", url);
}

export default function App() {
  const [run, setRun] = useState<RunState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const runId = readRunId();
    if (!runId) return;
    api.getRun(runId).then(setRun, (e: Error) => setLoadError(e.message));
  }, []);

  const startRun = (newRun: RunState) => {
    writeRunId(newRun.id);
    setRun(newRun);
  };

  const reset = () => {
    writeRunId(null);
    setRun(null);
    setLoadError(null);
  };

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <h1 className="text-lg font-bold text-ink">CRM 시안 생성 프로토타입</h1>
          {run && (
            <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-900">
              새로 시작
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        {loadError && <p className="rounded bg-danger-soft p-3 text-sm text-danger-strong">{loadError}</p>}

        {!run ? (
          <InputForm onCreated={startRun} />
        ) : (
          <>
            <section className="rounded-xl border bg-white p-5 text-sm">
              <p className="text-xs text-gray-400">실행 {run.id}</p>
              <p className="mt-2">
                <span className="font-semibold">{run.input.target_id}</span> {run.input.persona} · {run.input.mood}
              </p>
              <p className="mt-1 text-gray-600">
                {run.input.product_name} · {run.input.colors} · 이미 사용된 1순위 Pod:{" "}
                {run.input.used_first_pod ?? "없음"}
              </p>
            </section>

            {STEP_ORDER.map((step, i) => {
              const previous = STEP_ORDER[i - 1];
              const locked = previous !== undefined && !isStepComplete(run, previous);
              return <StepPanel key={step} step={step} run={run} locked={locked} onChange={setRun} />;
            })}

            <HtmlPreview run={run} onChange={setRun} />
          </>
        )}
      </main>
    </div>
  );
}
