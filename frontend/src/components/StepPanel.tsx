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
import { CheckIcon, PencilIcon, RefreshIcon, SparkleIcon, Spinner } from "./icons";
import OptionCard from "./OptionCard";
import PodEditBox from "./PodEditBox";
import RequestBox from "./RequestBox";

interface Props {
  step: StepName;
  run: RunState;
  locked: boolean; // 앞 단계를 아직 고르지 않음
  onChange: (run: RunState) => void;
}

// 진행 중인 작업 표시용 키: "all" = 단계 전체, 슬롯 이름 = 그 슬롯 생성·선택, `${슬롯}#${안}` = 이미지 한 장 수정
type BusyKey = string | null;

/** 모든 단계 공통: 생성/재생성 → 슬롯마다 N개 카드 → 하나 선택 → 직접 수정 또는 AI에게 수정 요청.
 *  POD·카피 단계는 슬롯이 하나, 이미지 단계는 Pod마다 슬롯이 하나씩이다. */
export default function StepPanel({ step, run, locked, onChange }: Props) {
  const state = run.steps[step];
  const [busy, setBusy] = useState<BusyKey>(null);
  const [error, setError] = useState<string | null>(null);
  // 이미지 단계는 Pod 하나에 1~3분이 걸려서 Pod별로 차례로 요청한다. 끝난 Pod부터 바로 화면에 나온다.
  const [progress, setProgress] = useState<{ pod: string; done: number; total: number } | null>(null);

  const call = async (key: string, action: () => Promise<RunState>): Promise<boolean> => {
    setBusy(key);
    setError(null);
    try {
      onChange(await action());
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const laterSteps = STEP_ORDER.slice(STEP_ORDER.indexOf(step) + 1);
  const hasLaterWork = laterSteps.some((s) => Object.keys(run.steps[s].slots).length > 0) || run.html !== null;
  const confirmReset = () =>
    !hasLaterWork || window.confirm("이 단계를 바꾸면 뒤 단계 결과가 초기화됩니다. 계속할까요?");

  const pods = selectedPodOrder(run);
  const multiSlot = step === "image";
  // 이미지 단계는 ①에서 정한 Pod 순서대로, 아직 생성하지 않은 Pod도 자리를 보여준다
  const slotNames = multiSlot ? pods : Object.keys(state.slots);
  const generatedCount = Object.keys(state.slots).length;

  const generateEachPod = async () => {
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
    if (multiSlot) generateEachPod();
    else call("all", () => api.generate(run.id, step));
  };
  const busyLabel = progress ? `${progress.pod} 생성 중 (${progress.done + 1}/${progress.total})` : "생성 중…";

  return (
    <section id={`step-${step}`} className={`scroll-mt-24 rounded-xl border bg-white p-6 ${locked ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-ink">{STEP_LABELS[step]}</h2>
          {isStepComplete(run, step) && (
            <span className="flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary-pressed">
              <CheckIcon className="h-3 w-3" />
              선택 완료
            </span>
          )}
        </div>
        {generatedCount === 0 ? (
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

      <StepGuide step={step} run={run} locked={locked} generatedCount={generatedCount} />
      {error && <p className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger-strong">{error}</p>}

      {!locked &&
        slotNames.map((slotName, i) => (
          <SlotView
            key={slotName}
            step={step}
            run={run}
            slotName={slotName}
            title={multiSlot ? `${i + 1}. ${slotName}` : null}
            slot={state.slots[slotName] ?? null}
            busy={busy}
            onGenerate={
              multiSlot
                ? (feedback) => call(slotName, () => api.generate(run.id, step, slotName, feedback))
                : null
            }
            onSelect={(index, edited) =>
              confirmReset() && call(slotName, () => api.select(run.id, step, slotName, index, edited))
            }
            onRevise={(index, request, pod) =>
              confirmReset()
                ? call(multiSlot ? `${slotName}#${index}` : slotName, () =>
                    api.revise(run.id, step, { slot: slotName, index, request, pod }),
                  )
                : Promise.resolve(false)
            }
          />
        ))}
    </section>
  );
}

const FIRST_GUIDE: Record<StepName, string> = {
  pod: "입력한 타겟과 스펙을 보고 AI가 Pod 순서·레이아웃을 방향이 다른 3안으로 만듭니다.",
  copy: "고른 Pod 순서에 맞춰 5개 Pod의 카피를 3안으로 만듭니다.",
  image: "Pod마다 이미지 3안을 만듭니다. Pod 하나에 1~3분 걸리고, 끝난 Pod부터 바로 나타납니다.",
};

/** 지금 이 단계에서 무엇을 하면 되는지 한 줄로 알려준다. */
function StepGuide({ step, run, locked, generatedCount }: { step: StepName; run: RunState; locked: boolean; generatedCount: number }) {
  let text: string;
  if (locked) text = "앞 단계에서 안을 먼저 선택하세요.";
  else if (generatedCount === 0) text = FIRST_GUIDE[step];
  else if (!isStepComplete(run, step)) {
    if (step === "image") {
      const pods = selectedPodOrder(run);
      const chosen = pods.filter((pod) => run.steps.image.slots[pod]?.selected != null).length;
      text = `Pod마다 이미지를 한 장씩 클릭해 고르세요. (${chosen}/${pods.length} 선택) 마음에 들지 않으면 이미지 아래 "수정 요청"을 써 보세요.`;
    } else text = "마음에 드는 안을 클릭해 고르세요. 고른 안이 다음 단계의 입력이 됩니다.";
  } else
    text =
      step === "image"
        ? "모든 Pod를 골랐습니다. 아래 ④에서 시안을 조립하세요."
        : "다음 단계로 진행하세요. 필요하면 아래에서 직접 고치거나 AI에게 수정을 요청할 수 있습니다.";
  return <p className="mt-2 text-sm text-gray-500">{text}</p>;
}

interface SlotViewProps {
  step: StepName;
  run: RunState;
  slotName: string;
  title: string | null;
  slot: SlotState<StepName> | null; // 이미지 단계에서 아직 생성하지 않은 Pod는 null
  busy: BusyKey;
  onGenerate: ((feedback?: string) => Promise<boolean>) | null; // 이미지 단계: 이 Pod만 (요청 반영해) 다시 생성
  onSelect: (index: number, edited?: StepContents[StepName]) => void;
  onRevise: (index: number, request: string, pod?: string) => Promise<boolean>;
}

function SlotView({ step, run, slotName, title, slot, busy, onGenerate, onSelect, onRevise }: SlotViewProps) {
  const disabled = busy !== null;
  const [requesting, setRequesting] = useState(false); // 이 Pod 요청하며 다시 생성
  const [revising, setRevising] = useState<number | null>(null); // 수정 요청 중인 이미지 번호

  return (
    <div className={title ? "mt-6 border-t pt-5" : "mt-4"}>
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">
            {title}
            {slot?.selected != null && (
              <span className="ml-2 font-normal text-primary">{slot.selected + 1}번 선택</span>
            )}
          </h3>
          {onGenerate && (
            <div className="flex items-center gap-1.5">
              {busy === slotName && (
                <span className="flex items-center gap-1 text-xs text-gray-500">
                  <Spinner className="h-3.5 w-3.5" /> 생성 중 (1~3분)
                </span>
              )}
              {slot ? (
                <>
                  <button
                    onClick={() => setRequesting(true)}
                    disabled={disabled}
                    className="flex items-center gap-1 rounded-full border bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                    요청하며 다시 생성
                  </button>
                  <button
                    onClick={() => onGenerate()}
                    disabled={disabled}
                    title="이 Pod만 다시 생성"
                    aria-label={`${slotName} 다시 생성`}
                    className="flex h-7 w-7 items-center justify-center rounded-full border bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40"
                  >
                    <RefreshIcon className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => onGenerate()}
                  disabled={disabled}
                  className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
                >
                  <SparkleIcon className="h-3.5 w-3.5" />이 Pod 생성
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {requesting && onGenerate && (
        <div className="mt-3">
          <RequestBox
            placeholder={`${slotName} 이미지 3안에 모두 반영할 요청. 예: 밤 장면으로, 사람 없이 제품만, 더 따뜻한 색감`}
            submitLabel="요청 반영해 3안 다시 생성"
            busy={busy === slotName}
            disabled={disabled}
            onSubmit={async (feedback) => (await onGenerate(feedback)) && setRequesting(false)}
            onCancel={() => setRequesting(false)}
          />
        </div>
      )}

      {!slot ? (
        title && <p className="mt-3 rounded-lg bg-gray-100 p-4 text-sm text-gray-500">아직 생성하지 않았습니다.</p>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {slot.options.map((option, i) => {
            const selected = slot.selected === i;
            const shown = selected && slot.edited ? slot.edited : option;
            return (
              <div key={i} className="flex flex-col gap-2">
                <OptionCard
                  index={i}
                  step={step}
                  option={shown}
                  selected={selected}
                  edited={selected && slot.edited !== null}
                  disabled={disabled}
                  onSelect={() => !selected && onSelect(i)}
                />
                {step === "image" &&
                  (revising === i ? (
                    <RequestBox
                      placeholder="이 이미지에서 고칠 점. 예: 배경을 더 밝게, 손을 빼 주세요, 컵을 치워 주세요"
                      submitLabel="이 이미지 수정"
                      busy={busy === `${slotName}#${i}`}
                      disabled={disabled}
                      onSubmit={async (request) => (await onRevise(i, request)) && setRevising(null)}
                      onCancel={() => setRevising(null)}
                    />
                  ) : (
                    <button
                      onClick={() => setRevising(i)}
                      disabled={disabled}
                      className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />이 이미지 수정 요청
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      )}

      {slot?.selected != null && step === "copy" && (
        <CopyReviseBox
          key={`revise-${slot.selected}-${run.updated_at}`}
          content={(slot.edited ?? slot.options[slot.selected]).content as CopyContent}
          busy={busy === slotName}
          disabled={disabled}
          onSubmit={(pod, request) => onRevise(slot.selected!, request, pod)}
        />
      )}
      {slot?.selected != null && step === "copy" && (
        <CopyEditBox
          key={`${slot.selected}-${run.updated_at}`}
          content={(slot.edited ?? slot.options[slot.selected]).content as CopyContent}
          disabled={disabled}
          onSave={(edited) => onSelect(slot.selected!, edited)}
        />
      )}
      {slot?.selected != null && step === "pod" && (
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

/** 고른 카피안에서 Pod 하나를 골라 AI에게 수정을 요청한다. 나머지 Pod는 그대로 둔다. */
function CopyReviseBox({
  content,
  busy,
  disabled,
  onSubmit,
}: {
  content: CopyContent;
  busy: boolean;
  disabled: boolean;
  onSubmit: (pod: string, request: string) => Promise<boolean>;
}) {
  const [pod, setPod] = useState<string | null>(null);
  const target = content.pods.find((p) => p.pod === pod);

  return (
    <div className="mt-5 rounded-lg border p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <PencilIcon className="h-4 w-4 text-primary" />
        Pod별 수정 요청
      </p>
      <p className="mt-1 text-xs text-gray-500">고칠 Pod를 고르고 요청을 쓰면 AI가 그 Pod 카피만 다시 씁니다.</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {content.pods.map((p) => (
          <button
            key={p.pod}
            onClick={() => setPod(p.pod === pod ? null : p.pod)}
            disabled={disabled}
            className={`rounded-full border px-3 py-1 text-xs disabled:opacity-40 ${
              p.pod === pod ? "border-primary bg-primary-soft font-semibold text-primary-pressed" : "bg-white hover:bg-gray-100"
            }`}
          >
            {p.pod}
          </button>
        ))}
      </div>
      {target && (
        <div className="mt-3 space-y-2">
          <div className="rounded-md bg-gray-100 p-3 text-sm">
            <p className="font-semibold">{target.headline}</p>
            <p className="mt-1 text-gray-700">{target.body}</p>
          </div>
          <RequestBox
            key={target.pod}
            placeholder="예: 헤드카피를 더 짧고 강하게, 수치를 앞에 두기, 바디에 사용 장면 넣기"
            submitLabel={`${target.pod} 카피 수정`}
            busy={busy}
            disabled={disabled}
            onSubmit={async (request) => {
              if (await onSubmit(target.pod, request)) setPod(null);
            }}
            onCancel={() => setPod(null)}
          />
        </div>
      )}
    </div>
  );
}
