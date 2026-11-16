import { useState } from "react";
import type { ProductProfile, ProfileResult } from "../types";
import { Spinner } from "./icons";
import ProfileEditor from "./ProfileEditor";
import ProfileGenerator from "./ProfileGenerator";

interface Props {
  profile: ProductProfile | null; // 지금 쓰는 프로필 (null = 아직 불러오는 중)
  source: string; // 이 프로필이 어디서 왔는지 (예: 템플릿, AI 생성, 기본)
  product: { product_name: string; colors: string; pods: { name: string; spec: string }[] };
  currentPhotos: string[]; // 지금 사진 칸에 있는 올린 사진들 (AI 생성의 첫 후보)
  onGenerated: (result: ProfileResult) => void;
  onEdit?: (profile: ProductProfile) => void; // 고급 모드: 이번 실행의 규칙을 항목 단위로 고친다
  warnings: string[]; // AI가 사진을 보고 남긴 경고
  newProduct: boolean; // 템플릿 없이 새 제품: 아직 규칙이 없다 (사진 칸에서 AI로 만든다)
}

/** 제품 프로필(프롬프트의 제품별 블록). 템플릿에서 오거나, 새 제품이면 올린 사진으로 AI가 만든다.
 * AI는 사진마다 자리(정면·뒷면 등)를 정하고 제품 상태와 기기 묘사를 쓰며, 사진이 부족하면 경고한다. */
export default function ProfileField({ profile, source, product, currentPhotos, onGenerated, onEdit, warnings, newProduct }: Props) {
  const [open, setOpen] = useState(false); // AI로 만들기 칸
  const [details, setDetails] = useState(false);

  return (
    <fieldset className="space-y-3">
      <legend className="flex w-full items-center justify-between gap-4 text-sm font-medium">
        <span>제품 규칙 — ③ 이미지 프롬프트의 제품별 부분 (기기 묘사·제품 상태·사진 자리)</span>
        {!open && !newProduct && (
          <button type="button" onClick={() => setOpen(true)} className="shrink-0 text-sm text-primary hover:underline">
            사진으로 AI가 새로 만들기
          </button>
        )}
      </legend>

      <div className="rounded-lg border p-3 text-sm">
        {newProduct ? (
          <p className="text-xs text-gray-500">
            아직 없습니다. 아래 '제품 사진'에 사진을 올리고 AI로 만들어 주세요. Galaxy Z Fold라면 위에서 템플릿을 고르면 됩니다.
          </p>
        ) : profile ? (
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
        <ProfileGenerator
          product={product}
          initialPhotos={currentPhotos}
          intro="새 제품의 공식 사진을 올리면(정면·뒷면·측면·사용 상태 등 여러 각도) AI가 사진마다 자리를 정하고 제품 규칙을 씁니다. 위의 제품명·컬러·Pod 스펙도 함께 봅니다. 사진이 부족하거나 흐리면 경고합니다."
          onGenerated={(result) => {
            onGenerated(result);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
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
