import { useEffect, useState } from "react";
import { api, setUnauthorizedHandler } from "./api";
import ErrorMessage from "./components/ErrorMessage";
import FeedbackPage from "./components/FeedbackPage";
import FeedbackPanel from "./components/FeedbackPanel";
import HtmlPreview from "./components/HtmlPreview";
import InputForm from "./components/InputForm";
import LoginForm from "./components/LoginForm";
import RunList from "./components/RunList";
import SaveTemplateDialog from "./components/SaveTemplateDialog";
import StepPanel from "./components/StepPanel";
import TemplatesPage from "./components/TemplatesPage";
import { ColorChips } from "./components/ColorLineupField";
import Stepper from "./components/Stepper";
import { Spinner } from "./components/icons";
import { STEP_ORDER, isStepComplete, type Me, type RunInput, type RunState } from "./types";

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

// 실행이 없을 때 보여 줄 화면: 내 작업 목록 / 입력 폼
type Home = { view: "list" } | { view: "new"; input: RunInput | null } | { view: "feedback" } | { view: "templates" };

// 고급 모드 켜짐 여부는 이 브라우저에만 기억한다 (저장소를 못 쓰는 환경이면 매번 꺼진 채로 시작)
const ADVANCED_KEY = "crm.advanced";
function readAdvanced() {
  try {
    return window.localStorage.getItem(ADVANCED_KEY) === "1";
  } catch {
    return false;
  }
}

// html의 scroll-behavior: smooth 때문에 화면을 바꿀 때 아래에서부터 미끄러져 올라가지 않게 바로 맨 위로
const scrollToTop = () => window.scrollTo({ top: 0, behavior: "instant" });

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = 확인 중, null = 로그인 필요
  const [run, setRun] = useState<RunState | null>(null);
  const [home, setHome] = useState<Home>({ view: "list" });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [advanced, setAdvanced] = useState(readAdvanced);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    api.me().then(setMe, () => setMe(null));
  }, []);

  // 로그인이 확인되면 주소의 ?run= 실행을 연다
  useEffect(() => {
    if (!me) return;
    const runId = readRunId();
    if (runId) openRun(runId);
  }, [me]);

  const openRun = (runId: string) => {
    setLoadError(null);
    api.getRun(runId).then(
      (loaded) => {
        writeRunId(loaded.id);
        setRun(loaded);
        // 단계는 실행을 불러온 뒤에 그려지므로 주소의 #step-… 위치로 그때 이동한다
        requestAnimationFrame(() => {
          const target = window.location.hash && document.querySelector(window.location.hash);
          if (target) target.scrollIntoView({ behavior: "instant" });
          else scrollToTop();
        });
      },
      (e: Error) => {
        writeRunId(null);
        setLoadError(e.message);
      },
    );
  };

  const startRun = (newRun: RunState) => {
    writeRunId(newRun.id);
    setRun(newRun);
    // 입력 폼 맨 아래의 '시작하기'에서 넘어오므로, 실행 화면은 맨 위(① Pod)부터 보여 준다
    requestAnimationFrame(scrollToTop);
  };

  const goHome = (next: Home) => {
    writeRunId(null);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    scrollToTop();
    setRun(null);
    setHome(next);
    setLoadError(null);
    setNotice(null);
  };

  // 진행 상황은 서버에 남아 있어서 내 작업 목록에서 언제든 이어서 만들 수 있다
  const reset = () => {
    if (run && !window.confirm("입력 화면으로 돌아갑니다. 지금 입력값은 그대로 채워 둡니다. 계속할까요?")) return;
    goHome({ view: "new", input: run?.input ?? null });
  };

  const toggleAdvanced = () => {
    const next = !advanced;
    setAdvanced(next);
    try {
      window.localStorage.setItem(ADVANCED_KEY, next ? "1" : "0");
    } catch {
      // 저장소를 못 쓰면 이번 화면에서만 유지
    }
    // 실행 화면을 보고 있어도 돌아갈 화면을 바꿔 둔다 (끈 뒤 실행을 닫으면 템플릿 화면이 나오지 않게)
    if (!next && home.view === "templates") setHome({ view: "list" });
  };

  const logout = async () => {
    await api.logout().catch(() => null);
    goHome({ view: "list" });
    setMe(null);
  };

  if (me === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6 text-gray-400" />
      </div>
    );
  }
  if (me === null) return <LoginForm onLogin={setMe} />;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-2.5 text-sm">
          <button onClick={() => goHome({ view: "list" })} className="font-semibold text-ink">
            CRM 시안 생성
          </button>
          <nav className="flex items-center gap-4">
            <button
              onClick={() => goHome({ view: "list" })}
              className={!run && home.view === "list" ? "font-medium text-primary" : "text-gray-600 hover:text-gray-900"}
            >
              내 작업
            </button>
            <button
              onClick={() => goHome({ view: "new", input: null })}
              className={!run && home.view === "new" ? "font-medium text-primary" : "text-gray-600 hover:text-gray-900"}
            >
              새로 만들기
            </button>
            <button
              onClick={() => goHome({ view: "feedback" })}
              className={!run && home.view === "feedback" ? "font-medium text-primary" : "text-gray-600 hover:text-gray-900"}
            >
              피드백
            </button>
            {advanced && (
              <button
                onClick={() => goHome({ view: "templates" })}
                className={!run && home.view === "templates" ? "font-medium text-primary" : "text-gray-600 hover:text-gray-900"}
              >
                템플릿
              </button>
            )}
            <span className="text-gray-300">|</span>
            <label className="flex cursor-pointer items-center gap-1.5 text-gray-500" title="프롬프트의 제품 규칙을 항목 단위로 보고 고칩니다">
              <input type="checkbox" checked={advanced} onChange={toggleAdvanced} className="accent-primary" />
              고급 모드
            </label>
            <span className="text-gray-500">{me.username}</span>
            <button onClick={logout} className="text-gray-500 hover:text-gray-900">
              로그아웃
            </button>
          </nav>
        </div>
        {/* 실행 중에는 진행 단계도 위에 고정해 둔다 */}
        {run && (
          <div className="mx-auto flex max-w-6xl justify-center border-t px-6 py-3">
            <Stepper run={run} />
          </div>
        )}
      </header>

      <main className={`mx-auto max-w-6xl space-y-6 px-6 pt-8 ${run ? "pb-28" : "pb-8"}`}>
        {loadError && <ErrorMessage message={loadError} onClose={() => setLoadError(null)} />}

        {!run ? (
          home.view === "list" ? (
            <RunList onOpen={openRun} onNew={(input) => goHome({ view: "new", input })} />
          ) : home.view === "feedback" ? (
            <FeedbackPage onOpenRun={openRun} />
          ) : home.view === "templates" ? (
            <TemplatesPage />
          ) : (
            // key: 다른 입력으로 새로 만들기를 누르면 폼을 새로 채운다
            <InputForm key={JSON.stringify(home.input)} initial={home.input} onCreated={startRun} advanced={advanced} />
          )
        ) : (
          <>
            <section className="rounded-xl border bg-white p-5 text-sm">
              <p className="text-xs text-gray-400">실행 {run.id}</p>
              <p className="mt-2">
                <span className="font-semibold">{run.input.target_id}</span> {run.input.persona} · 소구 강도 {run.input.mood}
              </p>
              <p className="mt-1 text-gray-600">
                {run.input.product_name} · <ColorChips value={run.input.colors} />
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
              <div className="flex flex-wrap items-center gap-2">
                {notice && <span className="text-sm text-success">{notice}</span>}
                <button
                  onClick={() => {
                    setNotice(null);
                    setSavingTemplate(true);
                  }}
                  title="제품명·컬러·Pod·제품 사진을 다음에 불러올 수 있게 저장합니다"
                  className="rounded-lg border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  템플릿으로 저장
                </button>
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

            {/* 오른쪽 아래 떠 있는 버튼으로 어디서든 연다 (아래 여백 pb-28은 이 버튼 자리) */}
            <FeedbackPanel key={run.id} run={run} />
            {savingTemplate && (
              <SaveTemplateDialog
                run={run}
                onClose={() => setSavingTemplate(false)}
                onSaved={(message) => {
                  setSavingTemplate(false);
                  setNotice(message);
                  api.getRun(run.id).then(setRun, () => null); // 저장한 템플릿 id가 실행 입력에 붙는다
                }}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
