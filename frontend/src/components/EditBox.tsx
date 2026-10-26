import { useState } from "react";
import type { StepContents, StepName } from "../types";

interface Props {
  content: StepContents[StepName];
  disabled: boolean;
  onSave: (edited: StepContents[StepName]) => void;
}

/** 선택한 안을 JSON으로 고친다. 프로토타입용. 나중에 단계별 폼으로 바꾼다. */
export default function EditBox({ content, disabled, onSave }: Props) {
  const original = JSON.stringify(content, null, 2);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(original);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    try {
      onSave(JSON.parse(text));
      setError(null);
    } catch {
      setError("JSON 형식이 올바르지 않습니다.");
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-4 text-sm text-gray-500 underline hover:text-gray-900">
        선택한 안 직접 수정하기
      </button>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={14}
        className="w-full rounded-lg border bg-gray-50 p-3 font-mono text-xs"
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={disabled || text === original}
          className="rounded-lg bg-primary hover:bg-primary-hover active:bg-primary-pressed px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          수정 저장
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg border bg-white px-4 py-2 text-sm hover:bg-gray-100">
          닫기
        </button>
      </div>
    </div>
  );
}
