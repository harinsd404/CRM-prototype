import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { api, withBase } from "../api";
import type { ProfileResult } from "../types";
import { SparkleIcon, Spinner } from "./icons";

export const MAX_PROFILE_IMAGES = 10; // backend/app/steps/profile.py MAX_PROFILE_IMAGES
const ACCEPT = "image/png,image/jpeg,image/webp";

interface Props {
  product: { product_name: string; colors: string; pods: { name: string; spec: string }[] };
  initialPhotos: string[]; // 처음에 넣어 둘 올린 사진 이름. 나중에 늘어나면(페이지에서 가져온 사진) 뒤에 더한다
  onGenerated: (result: ProfileResult) => void;
  onCancel?: () => void;
  intro: string;
}

/** 제품 사진을 자유롭게 올리면 AI가 사진마다 자리(정면·뒷면 등)를 정하고 제품 규칙을 쓴다.
 * 새 제품 시작(사진 칸 대신)과 '사진으로 AI가 새로 만들기'(제품 규칙 칸)에서 같이 쓴다. */
export default function ProfileGenerator({ product, initialPhotos, onGenerated, onCancel, intro }: Props) {
  const [photos, setPhotos] = useState<string[]>(() => initialPhotos.slice(0, MAX_PROFILE_IMAGES));
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 처음 본 이름만 더한다 (사용자가 ✕로 뺀 사진이 부모가 다시 그려질 때 되살아나지 않게)
  const seen = useRef(new Set(initialPhotos));
  useEffect(() => {
    const fresh = initialPhotos.filter((name) => !seen.current.has(name));
    if (fresh.length === 0) return;
    fresh.forEach((name) => seen.current.add(name));
    setPhotos((prev) => [...prev, ...fresh.filter((name) => !prev.includes(name))].slice(0, MAX_PROFILE_IMAGES));
  }, [initialPhotos]);

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
      onGenerated(await api.generateProfile({ ...product, images: photos }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-primary/40 bg-primary-soft/40 p-3">
      <p className="text-xs text-gray-600">{intro}</p>
      <div className="flex flex-wrap gap-2">
        {photos.map((name, i) => (
          <div key={name} className="relative h-20 w-20 overflow-hidden rounded-md border bg-white">
            <img src={withBase(`/api/uploads/${name}`)} alt={`사진 ${i + 1}`} className="h-full w-full object-contain" />
            <span className="absolute left-1 top-1 rounded bg-white/90 px-1 text-[10px] text-gray-600">{i + 1}</span>
            <button
              type="button"
              onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
              disabled={busy}
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
      {busy && (
        // 이미지 생성 중 카드와 같은 모양: 사진을 보고 규칙을 쓰는 동안
        <div className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed bg-white py-6 text-sm text-gray-500">
          <Spinner className="h-4 w-4" /> 사진 {photos.length}장을 보고 제품 규칙을 만드는 중 (10~30초)
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={generate}
          disabled={busy || uploading || photos.length === 0}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
        >
          {busy ? <Spinner /> : <SparkleIcon />}
          {busy ? "만드는 중…" : "AI로 제품 규칙 만들기"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            취소
          </button>
        )}
      </div>
    </div>
  );
}
