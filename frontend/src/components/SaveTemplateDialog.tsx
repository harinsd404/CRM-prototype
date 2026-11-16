import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type { RunState, TemplateSummary } from "../types";

interface Props {
  run: RunState;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const fieldClass = "mt-1 w-full rounded-lg border bg-white p-2.5 text-sm";

/** 이 실행의 제품명·컬러·Pod·제품 사진을 템플릿으로 저장한다. 새 템플릿으로 만들거나 기존 템플릿을 덮어쓴다. */
export default function SaveTemplateDialog({ run, onClose, onSaved }: Props) {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [mode, setMode] = useState<"new" | "overwrite">(run.input.template_id != null ? "overwrite" : "new");
  const [name, setName] = useState(run.input.product_name);
  const [targetId, setTargetId] = useState<number | null>(run.input.template_id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listTemplates().then(
      (list) => {
        setTemplates(list);
        setTargetId((current) => current ?? list[0]?.id ?? null);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const target = templates?.find((t) => t.id === targetId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === "overwrite" && !window.confirm(`'${target?.name}' 템플릿을 이 실행의 내용으로 덮어씁니다. 모든 사용자에게 바뀝니다. 계속할까요?`))
      return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveRunAsTemplate(
        run.id,
        mode === "new" ? { template_id: null, name } : { template_id: targetId, name: null },
      );
      onSaved(`'${saved.name}' 템플릿에 저장했습니다.`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-gray-900/40 px-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-template-title"
        className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl"
      >
        <div>
          <h2 id="save-template-title" className="font-semibold">
            템플릿으로 저장
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            제품명·컬러·이번에 쓴 Pod와 스펙·제품 사진을 저장합니다. 템플릿은 모든 사용자가 함께 씁니다. 페르소나는 저장하지
            않습니다.
          </p>
        </div>

        <label className="flex items-start gap-2">
          <input
            type="radio"
            checked={mode === "new"}
            onChange={() => setMode("new")}
            className="mt-3 accent-primary"
          />
          <span className="flex-1">
            <span className="text-sm font-medium">새 템플릿으로 저장</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={() => setMode("new")}
              placeholder="템플릿 이름 (예: Galaxy Watch8)"
              maxLength={100}
              className={fieldClass}
            />
          </span>
        </label>

        <label className="flex items-start gap-2">
          <input
            type="radio"
            checked={mode === "overwrite"}
            onChange={() => setMode("overwrite")}
            disabled={!templates?.length}
            className="mt-3 accent-primary"
          />
          <span className="flex-1">
            <span className="text-sm font-medium">기존 템플릿 덮어쓰기</span>
            <select
              value={targetId ?? ""}
              onChange={(e) => setTargetId(Number(e.target.value))}
              onFocus={() => setMode("overwrite")}
              disabled={!templates?.length}
              className={fieldClass}
            >
              {templates?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.id === run.input.template_id ? " (이 실행이 불러온 템플릿)" : ""}
                </option>
              ))}
            </select>
            {mode === "overwrite" && (
              <span className="mt-1 block text-xs text-gray-500">
                이번에 쓰지 않은 그 템플릿의 Pod는 지우지 않고 꺼진 채로 남깁니다.
              </span>
            )}
          </span>
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
            취소
          </button>
          <button
            disabled={busy || (mode === "new" ? !name.trim() : targetId == null)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-40"
          >
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}
