import { useState, type FormEvent } from "react";
import { api } from "../api";
import { DEFAULT_COLORS, DEFAULT_PRODUCT_NAME, DEFAULT_SPECS } from "../defaults";
import { POD_NAMES, type Mood, type PodName, type RunInput, type RunState } from "../types";
import ProductImagesField from "./ProductImagesField";

interface Props {
  initial: RunInput | null; // 다시 시작하기: 직전 실행의 입력을 채워 둔다
  onCreated: (run: RunState) => void;
}

const fieldClass = "mt-1 w-full rounded-lg border bg-white p-2.5 text-sm";

export default function InputForm({ initial, onCreated }: Props) {
  const [input, setInput] = useState<RunInput>(initial ?? {
    target_id: "P1",
    persona: "",
    mood: "HOT",
    used_first_pod: null,
    product_name: DEFAULT_PRODUCT_NAME,
    colors: DEFAULT_COLORS,
    specs: DEFAULT_SPECS,
    product_images: {},
    extra_product_images: [],
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
          <span className="text-sm font-medium">소구 강도</span>
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
        <span className="text-sm font-medium">
          타겟 페르소나 (관심사) <span className="text-danger">*</span>
        </span>
        <textarea
          value={input.persona}
          onChange={(e) => set("persona", e.target.value)}
          rows={2}
          required
          placeholder="예: 콘텐츠 소비형 — 이동 중 영상·웹툰을 큰 화면으로 즐기는 20대"
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
        <legend className="flex w-full items-center justify-between gap-4 text-sm font-medium">
          <span>Pod별 스펙 (Fact) — 기본값이 채워져 있고 고쳐 쓸 수 있음. 비워 두면 "(입력 데이터 없음)"으로 처리</span>
          <button
            type="button"
            onClick={() => set("specs", DEFAULT_SPECS)}
            className="shrink-0 text-sm text-gray-500 underline hover:text-gray-900"
          >
            기본값으로 되돌리기
          </button>
        </legend>
        {POD_NAMES.map((pod) => (
          <label key={pod} className="flex items-start gap-3">
            <span className="w-24 shrink-0 pt-2.5 text-sm text-gray-600">{pod}</span>
            <textarea value={input.specs[pod]} onChange={(e) => setSpec(pod, e.target.value)} rows={3} className={fieldClass} />
          </label>
        ))}
      </fieldset>

      <ProductImagesField
        value={input.product_images ?? {}}
        onChange={(value) => set("product_images", value)}
        extras={input.extra_product_images ?? []}
        onExtrasChange={(value) => set("extra_product_images", value)}
      />

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          disabled={busy}
          className="rounded-lg bg-primary hover:bg-primary-hover active:bg-primary-pressed px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "만드는 중…" : "시작하기"}
        </button>
        <p className="text-xs text-gray-500">시작하면 ① Pod 순서 → ② 카피 → ③ 이미지 → ④ 시안 조립 순서로 진행합니다.</p>
      </div>
    </form>
  );
}
