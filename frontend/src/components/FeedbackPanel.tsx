import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { FEEDBACK_STEP_LABELS, type Feedback, type FeedbackStep, type RunState } from "../types";
import FeedbackItem from "./FeedbackItem";

const fieldClass = "mt-1 w-full rounded-lg border bg-white p-2.5 text-sm";

/** 실행 화면의 피드백: 만든 CRM에서 마음에 들지 않는 부분을 남긴다. 실행이 불러온 템플릿의 피드백으로 모인다.
 * 다시 생성·수정 요청도 자동으로 쌓이므로 이 실행의 피드백 목록에 함께 보인다. */
export default function FeedbackPanel({ run }: { run: RunState }) {
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

  const remove = async (id: number) => {
    if (!window.confirm("이 피드백을 지웁니다. 되돌릴 수 없습니다. 계속할까요?")) return;
    await api.deleteFeedback(id).catch((e: Error) => setError(e.message));
    load();
  };

  return (
    <section id="feedback" className="scroll-mt-28 rounded-xl border bg-white p-6">
      <h2 className="font-semibold">피드백</h2>
      <p className="mt-1 text-sm text-gray-500">
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
  );
}
