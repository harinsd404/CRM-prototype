import { useState } from "react";
import type { CopyContent } from "../types";

// 백엔드 check_copy와 같은 기준 (backend/app/steps/copy.py)
const HEADLINE_MAX = 20;
const BODY_MAX = 110;

interface Props {
  content: CopyContent;
  disabled: boolean;
  onSave: (edited: CopyContent) => void;
}

function Count({ length, max }: { length: number; max: number }) {
  return (
    <span className={`text-xs ${length > max ? "font-semibold text-red-600" : "text-gray-400"}`}>
      {length}/{max}
    </span>
  );
}

/** 선택한 카피안을 Pod별 헤드·바디 입력칸으로 고친다. 저장하면 백엔드가 같은 규칙으로 다시 검사한다. */
export default function CopyEditBox({ content, disabled, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [pods, setPods] = useState(content.pods);
  const changed = JSON.stringify(pods) !== JSON.stringify(content.pods);

  const update = (index: number, field: "headline" | "body", value: string) =>
    setPods((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-4 text-sm text-gray-500 underline hover:text-gray-900">
        선택한 카피 직접 수정하기
      </button>
    );
  }

  return (
    <div className="mt-4 space-y-4 rounded-lg border bg-gray-50 p-4">
      {pods.map((p, i) => (
        <div key={p.pod} className="space-y-1">
          <p className="text-xs font-semibold text-blue-600">{p.pod}</p>
          <div className="flex items-center gap-2">
            <input
              value={p.headline}
              onChange={(e) => update(i, "headline", e.target.value)}
              className="flex-1 rounded border bg-white px-2 py-1 text-sm font-semibold"
            />
            <Count length={p.headline.length} max={HEADLINE_MAX} />
          </div>
          <div className="flex items-start gap-2">
            <textarea
              value={p.body}
              onChange={(e) => update(i, "body", e.target.value)}
              rows={3}
              className="flex-1 rounded border bg-white px-2 py-1 text-sm"
            />
            <Count length={p.body.length} max={BODY_MAX} />
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <button
          onClick={() => onSave({ ...content, pods })}
          disabled={disabled || !changed}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          수정 저장
        </button>
        <button
          onClick={() => {
            setPods(content.pods);
            setOpen(false);
          }}
          className="rounded-lg border px-4 py-2 text-sm"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
