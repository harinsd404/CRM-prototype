import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type { Mood, PodName, RunInput, RunState, Template, TemplatePod, TemplateSummary } from "../types";
import PodsField, { podsValid } from "./PodsField";
import ProductImagesField from "./ProductImagesField";

interface Props {
  initial: RunInput | null; // 다시 시작하기·다른 페르소나로: 그 실행의 입력을 채워 둔다
  onCreated: (run: RunState) => void;
}

const fieldClass = "mt-1 w-full rounded-lg border bg-white p-2.5 text-sm";

// RunInput에서 pods는 따로(PodsField의 rows) 관리한다. 끈 Pod도 다시 켤 수 있게 남겨 두기 위해서다
type Fields = Omit<RunInput, "pods">;

const EMPTY: Fields = {
  template_id: null,
  target_id: "P1",
  persona: "",
  mood: "HOT",
  used_first_pod: null,
  product_name: "",
  colors: "",
  product_images: {},
  extra_product_images: [],
};

const toRows = (template: Template): TemplatePod[] => template.pods.map((pod) => ({ ...pod }));

export default function InputForm({ initial, onCreated }: Props) {
  const [fields, setFields] = useState<Fields>(() => (initial ? { ...EMPTY, ...initial } : EMPTY));
  const [rows, setRows] = useState<TemplatePod[]>(() => initial?.pods.map((pod) => ({ ...pod, enabled: true })) ?? []);
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [template, setTemplate] = useState<Template | null>(null); // 불러온 템플릿 (되돌리기용)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listTemplates().then(setTemplates, (e: Error) => setError(e.message));
    // 다른 페르소나로 만들 때도 템플릿 내용으로 되돌릴 수 있게 그 템플릿을 불러 둔다
    if (initial?.template_id != null) api.getTemplate(initial.template_id).then(setTemplate, () => null);
  }, [initial]);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((prev) => ({ ...prev, [key]: value }));

  const touched = fields.product_name.trim() !== "" || rows.length > 0;

  // 템플릿 적용: 제품명·컬러·Pod를 템플릿 내용으로 채운다 (페르소나 등 타겟 정보는 그대로)
  const applyTemplate = async (id: number | null) => {
    if (touched && !window.confirm("지금 입력한 제품 정보와 Pod를 템플릿 내용으로 바꿉니다. 계속할까요?")) return;
    setError(null);
    if (id === null) {
      setTemplate(null);
      setFields((prev) => ({ ...prev, template_id: null }));
      return;
    }
    try {
      const loaded = await api.getTemplate(id);
      setTemplate(loaded);
      setFields((prev) => ({
        ...prev,
        template_id: loaded.id,
        product_name: loaded.product_name,
        colors: loaded.colors,
        used_first_pod: null,
      }));
      setRows(toRows(loaded));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const usedPods = rows.filter((row) => row.enabled && row.name.trim());
  const canSubmit = podsValid(rows) && usedPods.some((row) => row.spec.trim());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      setError("Pod를 확인해 주세요. 체크한 Pod 중 하나 이상은 스펙이 있어야 합니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const pods = usedPods.map(({ name, key, spec, visual }) => ({ name: name.trim(), key: key.trim(), spec, visual }));
      const usedFirst = pods.some((pod) => pod.name === fields.used_first_pod) ? fields.used_first_pod : null;
      onCreated(await api.createRun({ ...fields, used_first_pod: usedFirst, pods }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border bg-white p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="font-semibold">입력 데이터</h2>
        <label className="block min-w-64">
          <span className="text-sm font-medium">제품 템플릿</span>
          <select
            value={fields.template_id ?? ""}
            onChange={(e) => applyTemplate(e.target.value ? Number(e.target.value) : null)}
            className={fieldClass}
          >
            <option value="">선택 안 함 (직접 입력)</option>
            {templates?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · Pod {t.pod_count}개
              </option>
            ))}
          </select>
        </label>
      </div>
      {!touched && (
        <p className="rounded-lg bg-primary-soft px-4 py-3 text-sm text-gray-700">
          제품 템플릿을 고르면 제품명·컬러·Pod와 스펙이 채워집니다. 템플릿 없이 직접 입력해도 됩니다.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <label className="block">
          <span className="text-sm font-medium">타겟 구분</span>
          <input value={fields.target_id} onChange={(e) => set("target_id", e.target.value)} required className={fieldClass} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">소구 강도</span>
          <select value={fields.mood} onChange={(e) => set("mood", e.target.value as Mood)} className={fieldClass}>
            <option>HOT</option>
            <option>WARM</option>
            <option>COLD</option>
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-medium">이미 사용된 1순위 Pod</span>
          <select
            value={fields.used_first_pod ?? ""}
            onChange={(e) => set("used_first_pod", (e.target.value || null) as PodName | null)}
            className={fieldClass}
          >
            <option value="">없음</option>
            {usedPods.map((row) => (
              <option key={row.name}>{row.name.trim()}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium">
          타겟 페르소나 (관심사) <span className="text-danger">*</span>
        </span>
        <textarea
          value={fields.persona}
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
          <input
            value={fields.product_name}
            onChange={(e) => set("product_name", e.target.value)}
            required
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">컬러 라인업 (쉼표로 구분)</span>
          <input value={fields.colors} onChange={(e) => set("colors", e.target.value)} required className={fieldClass} />
        </label>
      </div>

      <PodsField rows={rows} onChange={setRows} onReset={template ? () => setRows(toRows(template)) : undefined} />

      <ProductImagesField
        value={fields.product_images ?? {}}
        onChange={(value) => set("product_images", value)}
        extras={fields.extra_product_images ?? []}
        onExtrasChange={(value) => set("extra_product_images", value)}
      />

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          disabled={busy || !canSubmit}
          className="rounded-lg bg-primary hover:bg-primary-hover active:bg-primary-pressed px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "만드는 중…" : "시작하기"}
        </button>
        <p className="text-xs text-gray-500">시작하면 ① Pod 순서 → ② 카피 → ③ 이미지 → ④ 시안 조립 순서로 진행합니다.</p>
      </div>
    </form>
  );
}
