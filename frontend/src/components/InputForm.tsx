import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type {
  Mood,
  ProductProfile,
  ProfileResult,
  RunInput,
  RunState,
  Template,
  TemplatePod,
  TemplateSummary,
} from "../types";
import ColorLineupField from "./ColorLineupField";
import PodsField, { podsValid } from "./PodsField";
import ProductImagesField, { type VisiblePhoto } from "./ProductImagesField";
import ProfileField from "./ProfileField";
import ProfileGenerator from "./ProfileGenerator";

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
  product_name: "",
  colors: "",
  product_images: {},
  extra_product_images: [],
  profile: null,
  profile_version: null,
};

const toRows = (template: Template): TemplatePod[] => template.pods.map((pod) => ({ ...pod }));

type Baseline = { images: Record<string, string | null>; extras: string[]; label: string };

// 배정된 사진을 입력 형식으로: 프로필의 모든 자리를 적는다 (사진이 없는 자리 = null, assets의 Fold 사진을 쓰지 않게)
const slotImages = (profile: ProductProfile, images: Record<string, string>) =>
  Object.fromEntries(profile.photo_slots.map((slot) => [slot.key, images[slot.key] ?? null]));

const templateBaseline = (template: Template, fallback: ProductProfile): Baseline => ({
  images: slotImages(template.profile ?? fallback, template.product_images),
  extras: [...template.extra_product_images],
  label: "템플릿 사진",
});

export default function InputForm({ initial, onCreated }: Props) {
  const [fields, setFields] = useState<Fields>(() => (initial ? { ...EMPTY, ...initial } : EMPTY));
  const [rows, setRows] = useState<TemplatePod[]>(() => initial?.pods.map((pod) => ({ ...pod, enabled: true })) ?? []);
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [template, setTemplate] = useState<Template | null>(null); // 불러온 템플릿 (되돌리기용)
  const [defaultProfile, setDefaultProfile] = useState<ProductProfile | null>(null); // Fold (프로필이 없을 때)
  const [baseline, setBaseline] = useState<Baseline | null>(null); // 사진 칸의 '되돌리기' 기준
  const [profileSource, setProfileSource] = useState(initial?.profile ? "이전 실행의 규칙" : "기본 (Galaxy Z Fold)");
  const [profileWarnings, setProfileWarnings] = useState<string[]>([]); // AI가 사진을 보고 남긴 경고
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listTemplates().then(setTemplates, (e: Error) => setError(e.message));
    Promise.all([
      api.defaultProfile(),
      // 다른 페르소나로 만들 때도 템플릿 내용으로 되돌릴 수 있게 그 템플릿을 불러 둔다
      initial?.template_id != null ? api.getTemplate(initial.template_id).catch(() => null) : null,
    ]).then(([fold, loaded]) => {
      setDefaultProfile(fold);
      if (loaded) {
        setTemplate(loaded);
        setBaseline(templateBaseline(loaded, fold));
        setProfileSource(`템플릿 '${loaded.name}'`);
      }
    }, (e: Error) => setError(e.message));
  }, [initial]);

  const profile = fields.profile ?? defaultProfile;
  // 템플릿 없이 새 제품: 규칙이 아직 없으니 Fold 사진 자리 대신 '사진 올리고 AI로 규칙 만들기'를 보여 준다.
  // 예전 실행(프로필 없이 Fold로 만든 것)을 다시 시작할 때는 그대로 Fold로 둔다
  const legacyFold = !!initial && !initial.profile;
  const newProduct = !fields.profile && fields.template_id == null && !legacyFold;

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((prev) => ({ ...prev, [key]: value }));

  const touched = fields.product_name.trim() !== "" || rows.length > 0;

  // 템플릿 적용: 제품명·컬러·Pod를 템플릿 내용으로 채운다 (페르소나 등 타겟 정보는 그대로)
  const applyTemplate = async (id: number | null) => {
    if (touched && !window.confirm("지금 입력한 제품 정보와 Pod를 템플릿 내용으로 바꿉니다. 계속할까요?")) return;
    setError(null);
    if (id === null) {
      // 새 제품으로: 템플릿의 규칙·사진도 비운다 (사진을 올리고 AI로 다시 만든다)
      setTemplate(null);
      setBaseline(null);
      setProfileWarnings([]);
      setFields((prev) => ({
        ...prev,
        template_id: null,
        profile_version: null,
        profile: null,
        product_images: {},
        extra_product_images: [],
      }));
      return;
    }
    try {
      const loaded = await api.getTemplate(id);
      const base = templateBaseline(loaded, defaultProfile ?? (await api.defaultProfile()));
      setTemplate(loaded);
      setBaseline(base);
      setProfileSource(`템플릿 '${loaded.name}'`);
      setFields((prev) => ({
        ...prev,
        template_id: loaded.id,
        product_name: loaded.product_name,
        colors: loaded.colors,
        product_images: base.images,
        extra_product_images: base.extras,
        profile: loaded.profile,
        profile_version: loaded.profile_version,
      }));
      setRows(toRows(loaded));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // AI가 새 제품 규칙을 만들면: 프로필·사진 배정을 채우고, 비어 있는 Pod 기본 연출도 채운다
  const applyGenerated = (result: ProfileResult) => {
    const images = slotImages(result.profile, result.product_images);
    setFields((prev) => ({
      ...prev,
      profile: result.profile,
      product_images: images,
      extra_product_images: result.extra_product_images,
    }));
    setBaseline({ images, extras: result.extra_product_images, label: "AI가 배정한 사진" });
    setProfileWarnings(result.warnings);
    setProfileSource("AI가 사진으로 만듦 (템플릿으로 저장하면 다음에 불러올 수 있음)");
    setRows((prev) =>
      prev.map((row) => (row.visual.trim() || !result.pod_visuals[row.name] ? row : { ...row, visual: result.pod_visuals[row.name] })),
    );
  };

  // AI 생성의 첫 후보: 지금 사진 칸에 있는 올린 사진들
  const [visiblePhotos, setVisiblePhotos] = useState<VisiblePhoto[]>([]);
  useEffect(() => {
    if (newProduct) setVisiblePhotos([]); // 사진 칸이 없을 때는 컬러 뽑기 후보도 비운다
  }, [newProduct]);
  const currentPhotos = [
    ...Object.values(fields.product_images ?? {}).filter((name): name is string => !!name),
    ...(fields.extra_product_images ?? []),
  ];

  const usedPods = rows.filter((row) => row.enabled && row.name.trim());
  const canSubmit = podsValid(rows) && usedPods.some((row) => row.spec.trim());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      setError("Pod를 확인해 주세요. 체크한 Pod 중 하나 이상은 스펙이 있어야 합니다.");
      return;
    }
    if (!fields.colors.trim()) {
      setError("컬러 라인업을 하나 이상 입력해 주세요.");
      return;
    }
    if (newProduct) {
      setError("제품 사진을 올리고 'AI로 제품 규칙 만들기'를 먼저 눌러 주세요. Galaxy Z Fold라면 템플릿을 고르면 됩니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const pods = usedPods.map(({ name, key, spec, visual }) => ({ name: name.trim(), key: key.trim(), spec, visual }));
      onCreated(await api.createRun({ ...fields, pods }));
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
            <option value="">새 제품 (사진으로 규칙 만들기)</option>
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
          제품 템플릿을 고르면 제품명·컬러·Pod와 스펙이 채워집니다. 새 제품이면 템플릿 없이 입력하고, 아래 '제품 사진'에 사진을 올려 AI로 제품 규칙을 만드세요.
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
        <div className="md:col-span-2">
          <ColorLineupField value={fields.colors} onChange={(colors) => set("colors", colors)} photos={visiblePhotos} />
        </div>
      </div>

      <PodsField rows={rows} onChange={setRows} onReset={template ? () => setRows(toRows(template)) : undefined} />

      <ProfileField
        profile={profile}
        source={profileSource}
        product={{
          product_name: fields.product_name,
          colors: fields.colors,
          pods: usedPods.map((row) => ({ name: row.name.trim(), spec: row.spec })),
        }}
        currentPhotos={currentPhotos}
        onGenerated={applyGenerated}
        warnings={profileWarnings}
        newProduct={newProduct}
        onEdit={
          profile
            ? (edited) => {
                setFields((prev) => ({ ...prev, profile: edited }));
                setProfileSource("이번 실행에서 고침 (템플릿에는 저장되지 않음)");
              }
            : undefined
        }
      />

      {newProduct ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">제품 사진 — ③ 이미지를 만들 때 제품 모양·색의 기준으로 함께 보냄</legend>
          <ProfileGenerator
            product={{
              product_name: fields.product_name,
              colors: fields.colors,
              pods: usedPods.map((row) => ({ name: row.name.trim(), spec: row.spec })),
            }}
            initialPhotos={[]}
            onGenerated={applyGenerated}
            intro="제품 공식 사진을 자유롭게 올려 주세요 (정면·뒷면·측면·착용/사용 모습·컬러 라인업 등 여러 각도). AI가 사진마다 자리를 정하고, 이 제품에 맞는 제품 규칙(기기 묘사·제품 상태)을 씁니다. 만든 뒤에는 자리별로 사진을 바꾸거나 더 올릴 수 있습니다."
          />
        </fieldset>
      ) : (
        <ProductImagesField
          value={fields.product_images ?? {}}
          onChange={(value) => set("product_images", value)}
          extras={fields.extra_product_images ?? []}
          onExtrasChange={(value) => set("extra_product_images", value)}
          baseline={baseline}
          profile={fields.profile ?? null}
          foldPhotos={!fields.profile || fields.profile.device_noun.trim() === defaultProfile?.device_noun}
          onVisiblePhotos={setVisiblePhotos}
        />
      )}

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
