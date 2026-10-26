import { useState } from "react";
import { api } from "../api";
import {
  MAIN_SLOT,
  STEP_LABELS,
  STEP_ORDER,
  isStepComplete,
  type CopyContent,
  type RunState,
  type SlotState,
  type StepContents,
  type StepName,
} from "../types";
import CopyEditBox from "./CopyEditBox";
import EditBox from "./EditBox";
import OptionCard from "./OptionCard";

interface Props {
  step: StepName;
  run: RunState;
  locked: boolean; // 앞 단계를 아직 고르지 않음
  onChange: (run: RunState) => void;
}

/** 모든 단계 공통: 생성/재생성 → 슬롯마다 N개 카드 → 하나 선택 → (텍스트 단계는) 수정.
 *  POD·카피 단계는 슬롯이 하나, 이미지 단계는 Pod마다 슬롯이 하나씩이다. */
export default function StepPanel({ step, run, locked, onChange }: Props) {
  const state = run.steps[step];
  // 진행 중인 작업: "all" 은 단계 전체, 그 밖은 슬롯 이름
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async (target: string, action: () => Promise<RunState>) => {
    setBusy(target);
    setError(null);
    try {
      onChange(await action());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const laterSteps = STEP_ORDER.slice(STEP_ORDER.indexOf(step) + 1);
  const hasLaterWork = laterSteps.some((s) => Object.keys(run.steps[s].slots).length > 0) || run.html !== null;
  const confirmReset = () =>
    !hasLaterWork || window.confirm("이 단계를 바꾸면 뒤 단계 결과가 초기화됩니다. 계속할까요?");

  const generateAll = () => confirmReset() && call("all", () => api.generate(run.id, step));

  // 이미지 단계는 ①에서 정한 Pod 순서대로 보여준다
  const slotNames =
    step === "image" ? podOrder(run).filter((pod) => pod in state.slots) : Object.keys(state.slots);
  const multiSlot = step === "image";

  return (
    <section className={`rounded-xl border bg-white p-6 ${locked ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">{STEP_LABELS[step]}</h2>
          {isStepComplete(state) && (
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary-pressed">선택 완료</span>
          )}
        </div>
        <button
          onClick={generateAll}
          disabled={locked || busy !== null}
          className="rounded-lg bg-primary hover:bg-primary-hover active:bg-primary-pressed px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy === "all" ? "생성 중…" : slotNames.length ? (multiSlot ? "전체 다시 생성" : "다시 생성") : "안 생성"}
        </button>
      </div>

      {locked && <p className="mt-3 text-sm text-gray-500">앞 단계에서 안을 먼저 선택하세요.</p>}
      {error && <p className="mt-3 rounded bg-danger-soft p-3 text-sm text-danger-strong">{error}</p>}

      {slotNames.map((slotName, i) => (
        <SlotView
          key={slotName}
          step={step}
          run={run}
          slotName={slotName}
          title={multiSlot ? `${i + 1}. ${slotName}` : null}
          slot={state.slots[slotName]}
          busy={busy}
          onRegenerate={multiSlot ? () => call(slotName, () => api.generate(run.id, step, slotName)) : null}
          onSelect={(index, edited) =>
            confirmReset() && call(slotName, () => api.select(run.id, step, slotName, index, edited))
          }
        />
      ))}
    </section>
  );
}

function podOrder(run: RunState): string[] {
  const pod = run.steps.pod.slots[MAIN_SLOT];
  const option = pod?.selected != null ? (pod.edited ?? pod.options[pod.selected]) : null;
  return option ? option.content.items.map((item) => item.pod) : [];
}

interface SlotViewProps {
  step: StepName;
  run: RunState;
  slotName: string;
  title: string | null;
  slot: SlotState<StepName>;
  busy: string | null;
  onRegenerate: (() => void) | null;
  onSelect: (index: number, edited?: StepContents[StepName]) => void;
}

function SlotView({ step, run, slotName, title, slot, busy, onRegenerate, onSelect }: SlotViewProps) {
  const disabled = busy !== null;
  return (
    <div className={title ? "mt-6 border-t pt-5" : ""}>
      {title && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {title}
            {slot.selected !== null && <span className="ml-2 font-normal text-primary">{slot.selected + 1}번 선택</span>}
          </h3>
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              disabled={disabled}
              className="rounded-lg border bg-white px-3 py-1.5 text-xs font-medium disabled:opacity-40 hover:bg-gray-100"
            >
              {busy === slotName ? "생성 중…" : "이 Pod만 다시 생성"}
            </button>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {slot.options.map((option, i) => {
          const selected = slot.selected === i;
          const shown = selected && slot.edited ? slot.edited : option;
          return (
            <OptionCard
              key={i}
              index={i}
              step={step}
              option={shown}
              selected={selected}
              edited={selected && slot.edited !== null}
              disabled={disabled}
              onSelect={() => !selected && onSelect(i)}
            />
          );
        })}
      </div>

      {/* 이미지는 고르기만 하고, 텍스트 단계는 고른 안을 사람이 다듬을 수 있다 */}
      {slot.selected !== null && step === "copy" && (
        <CopyEditBox
          key={`${slot.selected}-${run.updated_at}`}
          content={(slot.edited ?? slot.options[slot.selected]).content as CopyContent}
          disabled={disabled}
          onSave={(edited) => onSelect(slot.selected!, edited)}
        />
      )}
      {slot.selected !== null && step === "pod" && (
        <EditBox
          key={`${slot.selected}-${run.updated_at}`}
          content={(slot.edited ?? slot.options[slot.selected]).content}
          disabled={disabled}
          onSave={(edited) => onSelect(slot.selected!, edited)}
        />
      )}
    </div>
  );
}
