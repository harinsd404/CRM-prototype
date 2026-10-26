import { useState } from "react";
import { api } from "../api";
import {
  STEP_LABELS,
  STEP_ORDER,
  isStepComplete,
  selectedPodOrder,
  type CopyContent,
  type PodContent,
  type RunState,
  type SlotState,
  type StepContents,
  type StepName,
} from "../types";
import CopyEditBox from "./CopyEditBox";
import { RefreshIcon, SparkleIcon, Spinner } from "./icons";
import OptionCard from "./OptionCard";
import PodEditBox from "./PodEditBox";

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

  // 이미지 단계는 Pod 하나에 1~3분이 걸려서, 한 번에 요청하지 않고 Pod별로 차례로 요청한다.
  // 끝난 Pod부터 바로 화면에 나오고 진행 상황(2/5)이 보인다. 중간에 실패해도 앞의 Pod는 남는다.
  const [progress, setProgress] = useState<{ pod: string; done: number; total: number } | null>(null);

  const generateEachSlot = async () => {
    const pods = selectedPodOrder(run);
    setBusy("all");
    setError(null);
    try {
      for (const [i, pod] of pods.entries()) {
        setProgress({ pod, done: i, total: pods.length });
        onChange(await api.generate(run.id, step, pod));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
      setBusy(null);
    }
  };

  const generateAll = () => {
    if (!confirmReset()) return;
    if (step === "image") generateEachSlot();
    else call("all", () => api.generate(run.id, step));
  };
  const busyLabel = progress ? `${progress.pod} 생성 중 (${progress.done + 1}/${progress.total})` : "생성 중…";

  // 이미지 단계는 ①에서 정한 Pod 순서대로 보여준다
  const slotNames =
    step === "image" ? selectedPodOrder(run).filter((pod) => pod in state.slots) : Object.keys(state.slots);
  const multiSlot = step === "image";

  return (
    <section className={`rounded-xl border bg-white p-6 ${locked ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">{STEP_LABELS[step]}</h2>
          {isStepComplete(run, step) && (
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary-pressed">선택 완료</span>
          )}
        </div>
        {slotNames.length === 0 ? (
          // 처음 생성: 눈에 띄는 주요 버튼
          <button
            onClick={generateAll}
            disabled={locked || busy !== null}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-40"
          >
            {busy === "all" ? <Spinner /> : <SparkleIcon />}
            {busy === "all" ? busyLabel : "안 생성"}
          </button>
        ) : (
          // 이미 안이 있으면: 덮어쓰는 동작이라 한 단계 낮춘 보조 버튼
          <button
            onClick={generateAll}
            disabled={locked || busy !== null}
            className="flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40"
          >
            {busy === "all" ? <Spinner /> : <RefreshIcon />}
            {busy === "all" ? busyLabel : multiSlot ? "전체 다시 생성" : "다시 생성"}
          </button>
        )}
      </div>

      {locked && <p className="mt-3 text-sm text-gray-500">앞 단계에서 안을 먼저 선택하세요.</p>}
      {step === "image" && busy !== null && (
        <p className="mt-3 text-sm text-gray-500">이미지는 Pod 하나에 1~3분 걸립니다. 끝난 Pod부터 아래에 바로 나타납니다.</p>
      )}
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
              title="이 Pod만 다시 생성"
              aria-label={`${slotName} 다시 생성`}
              className="flex h-8 w-8 items-center justify-center rounded-full border bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40"
            >
              {busy === slotName ? <Spinner /> : <RefreshIcon />}
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
        <PodEditBox
          key={`${slot.selected}-${run.updated_at}`}
          content={(slot.edited ?? slot.options[slot.selected]).content as PodContent}
          disabled={disabled}
          onSave={(edited) => onSelect(slot.selected!, edited)}
        />
      )}
    </div>
  );
}
