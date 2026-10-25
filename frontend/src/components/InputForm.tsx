import { useState, type FormEvent } from "react";
import { api } from "../api";
import { POD_NAMES, type Mood, type PodName, type RunInput, type RunState } from "../types";

interface Props {
  onCreated: (run: RunState) => void;
}

const EMPTY_SPECS = Object.fromEntries(POD_NAMES.map((pod) => [pod, ""])) as Record<PodName, string>;

const fieldClass = "mt-1 w-full rounded-lg border p-2.5 text-sm";

export default function InputForm({ onCreated }: Props) {
  const [input, setInput] = useState<RunInput>({
    target_id: "P1",
    persona: "",
    mood: "HOT",
    used_first_pod: null,
    product_name: "",
    colors: "",
    specs: EMPTY_SPECS,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof RunInput>(key: K, value: RunInput[K]) => setInput((prev) => ({ ...prev, [key]: value }));
  const setSpec = (pod: PodName, value: string) => set("specs", { ...input.specs, [pod]: value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createRun(input));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border bg-white p-6">
      <h2 className="font-semibold">입력 데이터</h2>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="block">
          <span className="text-sm font-medium">타겟 구분</span>
          <input value={input.target_id} onChange={(e) => set("target_id", e.target.value)} required className={fieldClass} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">무드</span>
          <select value={input.mood} onChange={(e) => set("mood", e.target.value as Mood)} className={fieldClass}>
            <option>HOT</option>
            <option>WARM</option>
            <option>COLD</option>
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-medium">이미 사용된 1순위 Pod</span>
          <select
            value={input.used_first_pod ?? ""}
            onChange={(e) => set("used_first_pod", (e.target.value || null) as PodName | null)}
            className={fieldClass}
          >
            <option value="">없음</option>
            {POD_NAMES.map((pod) => (
              <option key={pod}>{pod}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium">타겟 페르소나 (관심사 / 소구 강도)</span>
        <textarea
          value={input.persona}
          onChange={(e) => set("persona", e.target.value)}
          rows={2}
          required
          className={fieldClass}
        />
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">제품명 (영문 공식)</span>
          <input value={input.product_name} onChange={(e) => set("product_name", e.target.value)} required className={fieldClass} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">컬러 라인업 (쉼표로 구분)</span>
          <input value={input.colors} onChange={(e) => set("colors", e.target.value)} required className={fieldClass} />
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Pod별 스펙 (Fact) — 비워 두면 "(입력 데이터 없음)"으로 처리</legend>
        {POD_NAMES.map((pod) => (
          <label key={pod} className="flex items-start gap-3">
            <span className="w-24 shrink-0 pt-2.5 text-sm text-gray-600">{pod}</span>
            <textarea value={input.specs[pod]} onChange={(e) => setSpec(pod, e.target.value)} rows={2} className={fieldClass} />
          </label>
        ))}
      </fieldset>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        disabled={busy}
        className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? "만드는 중…" : "시작하기"}
      </button>
    </form>
  );
}
