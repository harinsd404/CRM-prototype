import { useState } from "react";
import { FEEDBACK_SOURCE_LABELS, FEEDBACK_STATUS_LABELS, FEEDBACK_STEP_LABELS, type Feedback } from "../types";

interface Props {
  feedback: Feedback;
  showRun?: boolean; // 피드백 모아 보기: 템플릿·페르소나·작성자를 함께 보여 준다
  onStatus?: (status: Feedback["status"]) => void;
  onDelete?: () => void;
  onOpenRun?: () => void;
}

const STATUS_STYLES: Record<Feedback["status"], string> = {
  open: "bg-primary-soft text-primary",
  applied: "bg-success-soft text-success",
  dismissed: "bg-gray-100 text-gray-500",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 피드백 한 건. 당시 결과(context)는 펼쳐서 본다. */
export default function FeedbackItem({ feedback: f, showRun, onStatus, onDelete, onOpenRun }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <li className="space-y-1.5 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS_STYLES[f.status]}`}>{FEEDBACK_STATUS_LABELS[f.status]}</span>
        <span className="font-medium text-gray-700">
          {FEEDBACK_STEP_LABELS[f.step]}
          {f.pod && ` · ${f.pod}`}
        </span>
        <span className="text-gray-400">{FEEDBACK_SOURCE_LABELS[f.source]}</span>
        <span className="text-gray-400">
          {showRun && `${f.username} · `}
          {formatDate(f.created_at)}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm">{f.content}</p>
      {showRun && (
        <p className="text-xs text-gray-500">
          {f.template_name ?? "템플릿 없음"} · 페르소나 "{f.persona}"
          {onOpenRun && (
            <button onClick={onOpenRun} className="ml-2 text-primary hover:underline">
              실행 열기
            </button>
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-3 text-xs">
        {f.context && (
          <button onClick={() => setOpen(!open)} className="text-gray-500 hover:text-gray-900">
            {open ? "당시 결과 접기" : "당시 결과 보기"}
          </button>
        )}
        {onStatus && f.status !== "applied" && (
          <button onClick={() => onStatus("applied")} className="text-gray-500 hover:text-success">
            반영함
          </button>
        )}
        {onStatus && f.status !== "dismissed" && (
          <button onClick={() => onStatus("dismissed")} className="text-gray-500 hover:text-gray-900">
            보류
          </button>
        )}
        {onStatus && f.status !== "open" && (
          <button onClick={() => onStatus("open")} className="text-gray-500 hover:text-primary">
            다시 열기
          </button>
        )}
        {onDelete && f.mine && (
          <button onClick={onDelete} className="text-gray-500 hover:text-danger">
            삭제
          </button>
        )}
      </div>
      {open && <pre className="whitespace-pre-wrap rounded-lg bg-gray-50 p-2.5 text-xs text-gray-600">{f.context}</pre>}
    </li>
  );
}
