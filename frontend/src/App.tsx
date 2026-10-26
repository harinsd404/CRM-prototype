import { useEffect, useState } from "react";
import { api } from "./api";
import ErrorMessage from "./components/ErrorMessage";
import HtmlPreview from "./components/HtmlPreview";
import InputForm from "./components/InputForm";
import StepPanel from "./components/StepPanel";
import Stepper from "./components/Stepper";
import { STEP_ORDER, isStepComplete, type RunInput, type RunState } from "./types";

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
  const [lastInput, setLastInput] = useState<RunInput | null>(null);

  useEffect(() => {
    const runId = readRunId();
    if (!runId) return;
    api.getRun(runId).then(
      (loaded) => {
        setRun(loaded);
        // 단계는 실행을 불러온 뒤에 그려지므로 주소의 #step-… 위치로 그때 이동한다
        requestAnimationFrame(() => document.querySelector(window.location.hash || "#none")?.scrollIntoView());
      },
      (e: Error) => setLoadError(e.message),
    );
  }, []);

  const startRun = (newRun: RunState) => {
    writeRunId(newRun.id);
    setRun(newRun);
  };

  // 진행 상황은 서버에 남아 있어서 ?run= 주소로 언제든 돌아올 수 있다
  const reset = () => {
    if (run && !window.confirm("입력 화면으로 돌아갑니다. 지금 입력값은 그대로 채워 둡니다. 계속할까요?")) return;
    setLastInput(run?.input ?? null);
    writeRunId(null);
    window.scrollTo({ top: 0 });
    setRun(null);
    setLoadError(null);
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <h1 className="shrink-0 text-lg font-bold text-ink">CRM 시안 생성 프로토타입</h1>
          {run && <Stepper run={run} />}
          {run && (
            <button onClick={reset} className="shrink-0 text-sm text-gray-500 hover:text-gray-900">
              새로 시작
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        {loadError && <ErrorMessage message={loadError} onClose={() => setLoadError(null)} />}

        {!run ? (
          <InputForm initial={lastInput} onCreated={startRun} />
        ) : (
          <>
            <section className="rounded-xl border bg-white p-5 text-sm">
              <p className="text-xs text-gray-400">실행 {run.id}</p>
              <p className="mt-2">
                <span className="font-semibold">{run.input.target_id}</span> {run.input.persona} · 소구 강도 {run.input.mood}
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

            <footer className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5">
              <p className="text-sm text-gray-500">
                {run.html
                  ? "완성된 시안을 HTML·이미지·폰트·html_input.json 묶음(ZIP)으로 저장합니다."
                  : "④에서 시안을 조립하면 저장할 수 있습니다. 진행 상황은 자동으로 저장됩니다."}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={reset}
                  className="rounded-lg border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  다시 시작하기
                </button>
                {run.html ? (
                  <a
                    href={api.downloadUrl(run)}
                    download
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover active:bg-primary-pressed"
                  >
                    저장하기
                  </a>
                ) : (
                  <button
                    disabled
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white opacity-40"
                  >
                    저장하기
                  </button>
                )}
              </div>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
