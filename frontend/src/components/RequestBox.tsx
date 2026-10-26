import { useState } from "react";
import { Spinner } from "./icons";

interface Props {
  placeholder: string;
  submitLabel: string;
  busy: boolean;
  disabled: boolean;
  onSubmit: (request: string) => void;
  onCancel: () => void;
}

/** AI에게 보내는 수정 요청 입력칸. ⌘/Ctrl + Enter로 보낸다. */
export default function RequestBox({ placeholder, submitLabel, busy, disabled, onSubmit, onCancel }: Props) {
  const [text, setText] = useState("");
  const request = text.trim();
  const submit = () => request && !disabled && onSubmit(request);

  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary-soft/40 p-3">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && submit()}
        placeholder={placeholder}
        rows={2}
        maxLength={500}
        className="w-full rounded-md border bg-white p-2 text-sm"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !request}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
        >
          {busy && <Spinner />}
          {busy ? "반영하는 중…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
          취소
        </button>
        <span className="ml-auto text-xs text-gray-400">⌘/Ctrl + Enter로 보내기</span>
      </div>
    </div>
  );
}
