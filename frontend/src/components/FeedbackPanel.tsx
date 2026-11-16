import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { FEEDBACK_STEP_LABELS, type Feedback, type FeedbackStep, type RunState } from "../types";
import FeedbackItem from "./FeedbackItem";
import { MessageIcon } from "./icons";

const fieldClass = "mt-1 w-full rounded-lg border bg-white p-2.5 text-sm";

// 지금 화면에 보이는 단계 → 피드백 단계 (아래 단계부터 확인)
const SECTIONS: [string, FeedbackStep][] = [
  ["step-render", "result"],
  ["step-image", "image"],
  ["step-copy", "copy"],
  ["step-pod", "pod"],
];

function stepInView(): FeedbackStep | null {
  const line = window.innerHeight * 0.4;
  for (const [id, step] of SECTIONS) {
    const top = document.getElementById(id)?.getBoundingClientRect().top;
    if (top !== undefined && top <= line) return step;
  }
  return null;
}

/** 실행 화면의 피드백: 만든 CRM에서 마음에 들지 않는 부분을 남긴다. 실행이 불러온 템플릿의 피드백으로 모인다.
 * 다시 생성·수정 요청도 자동으로 쌓이므로 이 실행의 피드백 목록에 함께 보인다.
 * 화면 오른쪽 아래 버튼으로 어디서든 연다. 창은 화면을 막지 않아서 열어 둔 채로 스크롤하며 쓸 수 있다. */
export default function FeedbackPanel({ run }: { run: RunState }) {
  const [open, setOpen] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [items, setItems] = useState<Feedback[] | null>(null);
  const [step, setStep] = useState<FeedbackStep>(run.html ? "result" : "copy");
  const [pod, setPod] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.runFeedback(run.id).then(setItems, (e: Error) => setError(e.message));
  // 다시 생성·수정 요청이 쌓이면 실행이 바뀌므로 그때 다시 읽는다
  useEffect(() => {
    load();
  }, [run.id, run.updated_at]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.addFeedback(run.id, { step, pod: pod || null, content });
      setContent("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 열 때 지금 보고 있는 단계를 미리 골라 둔다
  const toggle = () => {
    if (!open) setStep(stepInView() ?? (run.html ? "result" : "pod"));
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) return;
    textRef.current?.focus({ preventScroll: true }); // 열어도 보던 위치는 그대로
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const manualCount = items?.filter((f) => f.source === "manual").length ?? 0;

  const remove = async (id: number) => {
    if (!window.confirm("이 피드백을 지웁니다. 되돌릴 수 없습니다. 계속할까요?")) return;
    await api.deleteFeedback(id).catch((e: Error) => setError(e.message));
    load();
  };

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={`fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold shadow-lg transition ${
          open ? "bg-ink text-white" : "bg-primary text-white hover:bg-primary-hover"
        }`}
      >
        <MessageIcon className="h-4 w-4" />
        {open ? "피드백 닫기" : "피드백"}
        {!open && manualCount > 0 && (
          <span className="rounded-full bg-white/25 px-1.5 text-xs">{manualCount}</span>
        )}
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="피드백"
          className="fixed bottom-24 right-6 z-40 max-h-[calc(100vh-8rem)] w-[min(440px,calc(100vw-3rem))] overflow-y-auto rounded-xl border bg-white p-5 shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">피드백</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-700"
              aria-label="피드백 닫기"
            >
              ✕
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            마음에 들지 않는 부분을 남기면 {run.input.template_id != null ? "이 제품 템플릿" : "템플릿 없음"}의 피드백으로 모여 프롬프트와
            로직을 고치는 데 씁니다. 다시 생성·수정 요청도 자동으로 쌓입니다.
          </p>

          <form onSubmit={submit} className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium">단계</span>
                <select value={step} onChange={(e) => setStep(e.target.value as FeedbackStep)} className={fieldClass}>
                  {Object.entries(FEEDBACK_STEP_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium">Pod (선택)</span>
                <select value={pod} onChange={(e) => setPod(e.target.value)} className={fieldClass}>
                  <option value="">전체</option>
                  {run.input.pods.map((p) => (
                    <option key={p.name}>{p.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              maxLength={1000}
              required
              ref={textRef}
              placeholder="예: 카메라 Pod 이미지에서 손 모양이 어색함 / 헤드카피가 모두 비슷한 구조"
              className={fieldClass}
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              disabled={busy || !content.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-40"
            >
              {busy ? "남기는 중…" : "피드백 남기기"}
            </button>
          </form>

          {items && items.length > 0 && (
            <ul className="mt-5 divide-y border-t">
              {items.map((f) => (
                <FeedbackItem key={f.id} feedback={f} onDelete={() => remove(f.id)} />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
