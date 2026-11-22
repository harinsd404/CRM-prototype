import { useState } from "react";
import { api } from "../api";
import type { PageImportResult } from "../types";
import { CheckIcon, Spinner } from "./icons";

interface Props {
  podNames: string[]; // 지금 체크한 Pod 이름: 스펙을 이 Pod별로 나눠 받는다 (없으면 AI가 Pod를 제안)
  onApply: (result: PageImportResult) => void; // 제품명·컬러·Pod 스펙을 입력에 채운다
  onPhotos: (names: string[]) => void; // 고른 사진을 올린 사진으로 가져온 뒤
  maxPhotos: number; // 한 번에 가져올 수 있는 사진 수 (새 제품 = AI 규칙 만들기 최대, 아니면 남은 추가 사진 칸)
  photoTarget: string; // 가져온 사진이 들어가는 곳 (안내 문구)
}

const inputClass = "w-full rounded-lg border bg-white p-2.5 text-sm";

/** 삼성닷컴 제품 페이지 주소를 넣으면 제품명·컬러·Pod별 스펙을 AI가 정리하고, 제품 사진 후보를 보여 준다.
 * 바로 덮어쓰지 않고 미리 본 뒤 '입력에 채우기'로 넣는다. 사진은 사람이 골라서 가져온다. */
export default function ProductPageImport({ podNames, onApply, onPhotos, maxPhotos, photoTarget }: Props) {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<PageImportResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<"page" | "photos" | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setBusy("page");
    setError(null);
    setResult(null);
    setApplied(false);
    setPicked([]);
    setPhotoNote(null);
    try {
      setResult(await api.importProductPage({ url: url.trim(), pods: podNames }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggle = (src: string) =>
    setPicked((prev) => (prev.includes(src) ? prev.filter((u) => u !== src) : prev.length < maxPhotos ? [...prev, src] : prev));

  const importPhotos = async () => {
    setBusy("photos");
    setError(null);
    try {
      const images = await api.importPageImages(picked);
      onPhotos(images.map((image) => image.name));
      setPhotoNote(`사진 ${images.length}장을 ${photoTarget}에 넣었습니다.`);
      setPicked([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="rounded-lg border bg-gray-50 p-3" open={!!result}>
      <summary className="cursor-pointer text-sm font-medium">삼성닷컴 제품 페이지에서 가져오기</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-gray-500">
          제품 페이지 주소를 넣으면 제품 정보·스펙·구매 페이지를 읽어 제품명, 컬러, Pod별 스펙을 정리합니다
          {podNames.length > 0 ? ` (지금 Pod ${podNames.length}개 기준)` : " (Pod가 없으면 페이지 내용으로 제안)"}.
          스펙은 카피 팩트체크의 근거가 되니 채우기 전에 확인해 주세요.
        </p>
        {/* 바깥 입력 폼 안에 있으므로 form을 겹치지 않고 Enter·버튼으로 직접 부른다 */}
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (url.trim() && !busy) void load();
              }
            }}
            placeholder="https://www.samsung.com/sec/smartphones/galaxy-z-fold8/"
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={!url.trim() || !!busy}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
          >
            {busy === "page" && <Spinner />}
            {busy === "page" ? "읽는 중… (20~40초)" : "가져오기"}
          </button>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}

        {result && (
          <div className="space-y-3 rounded-lg border bg-white p-3 text-sm">
            <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[6rem_1fr]">
              <dt className="text-gray-500">제품명</dt>
              <dd>{result.product_name || "(못 찾음)"}</dd>
              <dt className="text-gray-500">컬러</dt>
              <dd>{result.colors || "(못 찾음)"}</dd>
            </dl>
            <ul className="space-y-1.5">
              {result.pods.map((pod) => (
                <li key={pod.name} className="rounded bg-gray-50 p-2">
                  <span className="font-medium">{pod.name}</span>
                  <span className="ml-1 text-xs text-gray-400">{pod.key}</span>
                  <p className="mt-0.5 text-xs text-gray-700">{pod.spec}</p>
                </li>
              ))}
            </ul>
            {result.warnings.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => {
                onApply(result);
                setApplied(true);
              }}
              className="flex items-center gap-1.5 rounded-lg border bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-100"
            >
              {applied && <CheckIcon />}
              {applied ? "채웠습니다 (다시 채우기)" : "입력에 채우기"}
            </button>

            {result.images.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs text-gray-600">
                  제품 사진 후보 {result.images.length}장 — 글자·연출이 없는 제품 단독 컷(정면·뒷면·측면·펼친 모습)을 고르세요.
                  최대 {maxPhotos}장, {photoTarget}에 들어갑니다.
                </p>
                <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
                  {result.images.map((image) => {
                    const on = picked.includes(image.url);
                    return (
                      <button
                        type="button"
                        key={image.url}
                        onClick={() => toggle(image.url)}
                        title={`${image.width}×${image.height}`}
                        className={`relative aspect-square overflow-hidden rounded-md border-2 bg-white ${
                          on ? "border-primary" : "border-transparent hover:border-gray-300"
                        }`}
                      >
                        <img
                          src={image.url}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-contain"
                        />
                        {on && (
                          <span className="absolute right-1 top-1 rounded-full bg-primary px-1.5 text-[10px] text-white">
                            {picked.indexOf(image.url) + 1}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {photoNote && <p className="text-xs text-gray-600">{photoNote}</p>}
                <button
                  type="button"
                  onClick={importPhotos}
                  disabled={picked.length === 0 || !!busy || maxPhotos === 0}
                  className="flex items-center gap-1.5 rounded-lg border bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-100 disabled:opacity-40"
                >
                  {busy === "photos" && <Spinner />}
                  {maxPhotos === 0 ? "더 넣을 사진 칸이 없습니다" : `고른 사진 ${picked.length}장 가져오기`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
