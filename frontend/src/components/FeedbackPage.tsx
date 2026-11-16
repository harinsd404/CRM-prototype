import { useEffect, useState } from "react";
import { api } from "../api";
import {
  FEEDBACK_SOURCE_LABELS,
  FEEDBACK_STATUS_LABELS,
  type Feedback,
  type FeedbackFilter,
  type FeedbackSource,
  type FeedbackStatus,
  type TemplateSummary,
} from "../types";
import FeedbackItem from "./FeedbackItem";
import { Spinner } from "./icons";

const selectClass = "rounded-lg border bg-white p-2 text-sm";

/** 템플릿별 피드백 모아 보기 (모든 사용자). 프롬프트·로직을 고칠 사람이 확인하고 반영함/보류로 표시한다. */
export default function FeedbackPage({ onOpenRun }: { onOpenRun: (runId: string) => void }) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [filter, setFilter] = useState<FeedbackFilter>({ template: null, status: "open", source: null });
  const [items, setItems] = useState<Feedback[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listTemplates().then(setTemplates, (e: Error) => setError(e.message));
  }, []);

  const load = () => {
    setItems(null);
    api.listFeedback(filter).then(setItems, (e: Error) => setError(e.message));
  };
  useEffect(load, [filter]);

  const setStatus = async (id: number, status: FeedbackStatus) => {
    await api.setFeedbackStatus(id, status).catch((e: Error) => setError(e.message));
    load();
  };
  const remove = async (id: number) => {
    if (!window.confirm("이 피드백을 지웁니다. 되돌릴 수 없습니다. 계속할까요?")) return;
    await api.deleteFeedback(id).catch((e: Error) => setError(e.message));
    load();
  };

  return (
    <section className="rounded-xl border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">피드백 모아 보기</h2>
          <p className="mt-1 text-sm text-gray-500">모든 사용자가 남긴 피드백입니다. 확인한 뒤 반영함 또는 보류로 표시하세요.</p>
        </div>
        <a href={api.feedbackCsvUrl(filter)} className="text-sm text-primary hover:underline">
          CSV로 내려받기
        </a>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <select
          value={filter.template ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            setFilter({ ...filter, template: value === "" ? null : value === "none" ? "none" : Number(value) });
          }}
          aria-label="템플릿"
          className={selectClass}
        >
          <option value="">모든 템플릿</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          <option value="none">템플릿 없음</option>
        </select>
        <select
          value={filter.status ?? ""}
          onChange={(e) => setFilter({ ...filter, status: (e.target.value || null) as FeedbackStatus | null })}
          aria-label="상태"
          className={selectClass}
        >
          <option value="">모든 상태</option>
          {Object.entries(FEEDBACK_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={filter.source ?? ""}
          onChange={(e) => setFilter({ ...filter, source: (e.target.value || null) as FeedbackSource | null })}
          aria-label="종류"
          className={selectClass}
        >
          <option value="">모든 종류</option>
          {Object.entries(FEEDBACK_SOURCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      {items === null && !error && (
        <div className="flex justify-center py-10">
          <Spinner className="h-5 w-5 text-gray-400" />
        </div>
      )}
      {items?.length === 0 && <p className="py-10 text-center text-sm text-gray-500">조건에 맞는 피드백이 없습니다.</p>}
      {items && items.length > 0 && (
        <>
          <p className="mt-4 text-xs text-gray-500">{items.length}건</p>
          <ul className="divide-y">
            {items.map((f) => (
              <FeedbackItem
                key={f.id}
                feedback={f}
                showRun
                onStatus={(status) => setStatus(f.id, status)}
                onDelete={() => remove(f.id)}
                onOpenRun={f.mine ? () => onOpenRun(f.run_id) : undefined}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
