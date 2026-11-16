import { useState, type ChangeEvent } from "react";
import { api, withBase } from "../api";
import type { ProductProfile, ProfileResult } from "../types";
import { Spinner } from "./icons";
import ProfileEditor from "./ProfileEditor";

const MAX_PROFILE_IMAGES = 10; // backend/app/steps/profile.py MAX_PROFILE_IMAGES
const ACCEPT = "image/png,image/jpeg,image/webp";

interface Props {
  profile: ProductProfile | null; // 지금 쓰는 프로필 (null = 아직 불러오는 중)
  source: string; // 이 프로필이 어디서 왔는지 (예: 템플릿, AI 생성, 기본)
  product: { product_name: string; colors: string; pods: { name: string; spec: string }[] };
  currentPhotos: string[]; // 지금 사진 칸에 있는 올린 사진들 (AI 생성의 첫 후보)
  onGenerated: (result: ProfileResult) => void;
  onEdit?: (profile: ProductProfile) => void; // 고급 모드: 이번 실행의 규칙을 항목 단위로 고친다
}

/** 제품 프로필(프롬프트의 제품별 블록). 템플릿에서 오거나, 새 제품이면 올린 사진으로 AI가 만든다.
 * AI는 사진마다 자리(정면·뒷면 등)를 정하고 제품 상태와 기기 묘사를 쓰며, 사진이 부족하면 경고한다. */
export default function ProfileField({ profile, source, product, currentPhotos, onGenerated, onEdit }: Props) {
  const [open, setOpen] = useState(false); // AI로 만들기 칸
  const [details, setDetails] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setPhotos(currentPhotos.slice(0, MAX_PROFILE_IMAGES));
    setError(null);
    setOpen(true);
  };

  const add = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_PROFILE_IMAGES - photos.length);
    e.target.value = "";
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    const added: string[] = [];
    try {
      for (const file of files) added.push((await api.upload(file)).name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPhotos((prev) => [...prev, ...added]);
      setUploading(false);
    }
  };

  const generate = async () => {
    if (!product.product_name.trim()) {
      setError("제품명을 먼저 적어 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.generateProfile({ ...product, images: photos });
      setWarnings(result.warnings);
      onGenerated(result);
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="space-y-3">
      <legend className="flex w-full items-center justify-between gap-4 text-sm font-medium">
        <span>제품 규칙 — ③ 이미지 프롬프트의 제품별 부분 (기기 묘사·제품 상태·사진 자리)</span>
        {!open && (
          <button type="button" onClick={start} className="shrink-0 text-sm text-primary hover:underline">
            사진으로 AI가 새로 만들기
          </button>
        )}
      </legend>

      <div className="rounded-lg border p-3 text-sm">
        {profile ? (
          <>
            <p>
              <span className="font-medium">{profile.device_noun}</span>
              <span className="ml-2 text-xs text-gray-500">{source}</span>
            </p>
            <p className="mt-1 text-xs text-gray-600">
              제품 상태 {profile.states.map((s) => s.label).join(" · ")} / 사진 자리{" "}
              {profile.photo_slots.map((s) => s.label).join(" · ")}
            </p>
            <button type="button" onClick={() => setDetails(!details)} className="mt-1 text-xs text-gray-500 hover:text-gray-900">
              {details ? "자세히 접기" : onEdit ? "자세히 보기 · 이번 실행만 고치기" : "자세히 보기"}
            </button>
            {details && onEdit && (
              <div className="mt-2">
                <p className="mb-2 text-xs text-gray-500">
                  고급 모드: 여기서 고친 규칙은 이번 실행에만 쓰입니다. 템플릿에 남기려면 실행 화면에서 템플릿으로 저장하세요.
                </p>
                <ProfileEditor value={profile} onChange={onEdit} />
              </div>
            )}
            {details && !onEdit && (
              <div className="mt-2 space-y-2 text-xs text-gray-600">
                <pre className="whitespace-pre-wrap rounded bg-gray-50 p-2"># Device{"\n"}{profile.device_rules}</pre>
                {profile.states.map((state) => (
                  <pre key={state.key} className="whitespace-pre-wrap rounded bg-gray-50 p-2">
                    {state.label} — {state.brief_hint}
                    {"\n"}
                    {state.rules}
                  </pre>
                ))}
                {profile.copy_terms && <p>카피 공식 표기: {profile.copy_terms}</p>}
              </div>
            )}
          </>
        ) : (
          <Spinner className="h-4 w-4 text-gray-400" />
        )}
      </div>

      {open && (
        <div className="space-y-3 rounded-lg border border-primary/40 bg-primary-soft/40 p-3">
          <p className="text-xs text-gray-600">
            새 제품의 공식 사진을 올리면(정면·뒷면·측면·사용 상태 등 여러 각도) AI가 사진마다 자리를 정하고 제품 규칙을 씁니다.
            위의 제품명·컬러·Pod 스펙도 함께 봅니다. 사진이 부족하거나 흐리면 경고합니다.
          </p>
          <div className="flex flex-wrap gap-2">
            {photos.map((name, i) => (
              <div key={name} className="relative h-20 w-20 overflow-hidden rounded-md border bg-white">
                <img src={withBase(`/api/uploads/${name}`)} alt={`사진 ${i + 1}`} className="h-full w-full object-contain" />
                <span className="absolute left-1 top-1 rounded bg-white/90 px-1 text-[10px] text-gray-600">{i + 1}</span>
                <button
                  type="button"
                  onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                  aria-label={`사진 ${i + 1} 빼기`}
                  className="absolute right-1 top-1 rounded bg-white/90 px-1 text-xs text-gray-600 hover:text-danger"
                >
                  ✕
                </button>
              </div>
            ))}
            {photos.length < MAX_PROFILE_IMAGES && (
              <label
                className={`flex h-20 w-20 flex-col items-center justify-center rounded-md border border-dashed bg-white text-xs text-gray-500 ${
                  uploading ? "opacity-40" : "cursor-pointer hover:border-primary hover:text-primary"
                }`}
              >
                {uploading ? <Spinner className="h-4 w-4" /> : <span className="text-xl leading-none">+</span>}
                <span className="text-gray-400">
                  {photos.length}/{MAX_PROFILE_IMAGES}
                </span>
                <input type="file" accept={ACCEPT} multiple onChange={add} disabled={uploading} className="hidden" />
              </label>
            )}
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={busy || uploading || photos.length === 0}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
            >
              {busy ? "만드는 중… (10~30초)" : "AI로 제품 규칙 만들기"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-0.5 rounded-lg bg-warning-soft p-3 text-xs text-warning">
          <li className="font-medium">AI가 사진을 보고 남긴 경고</li>
          {warnings.map((warning) => (
            <li key={warning}>⚠ {warning}</li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
