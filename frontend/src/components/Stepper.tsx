import { STEP_ORDER, isStepComplete, type RunState } from "../types";
import { CheckIcon } from "./icons";

const ITEMS = [
  { id: "step-pod", label: "Pod 순서" },
  { id: "step-copy", label: "카피" },
  { id: "step-image", label: "이미지" },
  { id: "step-render", label: "시안 조립" },
];

/** 상단 진행 표시: 끝난 단계는 ✓, 지금 할 단계는 파랗게. 누르면 그 단계로 이동한다. */
export default function Stepper({ run }: { run: RunState }) {
  const done = [...STEP_ORDER.map((step) => isStepComplete(run, step)), run.html !== null];
  const current = done.indexOf(false);

  return (
    <nav aria-label="진행 단계" className="flex items-center gap-1 overflow-x-auto">
      {ITEMS.map((item, i) => {
        const state = done[i] ? "done" : i === current ? "current" : "todo";
        return (
          <div key={item.id} className="flex items-center gap-1">
            {i > 0 && <span className={`h-px w-4 sm:w-8 ${done[i - 1] ? "bg-primary" : "bg-gray-300"}`} />}
            <a
              href={`#${item.id}`}
              aria-current={state === "current" ? "step" : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                state === "current" ? "bg-primary-soft font-semibold text-primary-pressed" : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                  state === "done"
                    ? "bg-primary text-white"
                    : state === "current"
                      ? "border-2 border-primary text-primary"
                      : "border border-gray-300"
                }`}
              >
                {state === "done" ? <CheckIcon className="h-3 w-3" /> : i + 1}
              </span>
              {item.label}
            </a>
          </div>
        );
      })}
    </nav>
  );
}
