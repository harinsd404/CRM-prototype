import { useRef, useState } from "react";
import { api } from "../api";
import { useLeaveWarning, useRunPolling } from "../hooks";
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
import ErrorMessage from "./ErrorMessage";
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

/** 서버는 한 실행에서 생성·수정 요청을 하나씩만 받는다. 그동안 들어온 요청은 대기열에 넣었다가 차례로 보낸다. */
interface QueuedJob {
  id: number;
  slot: string;
  label: string;
  key: BusyKey;
  action: () => Promise<RunState>;
}

/** 모든 단계 공통: 생성/재생성 → 슬롯마다 N개 카드 → 하나 선택 → 직접 수정 또는 AI에게 수정 요청.
 *  POD·카피 단계는 슬롯이 하나, 이미지 단계는 Pod마다 슬롯이 하나씩이다. */
export default function StepPanel({ step, run, locked, onChange }: Props) {
  const state = run.steps[step];
  const [busy, setBusy] = useState<BusyKey>(null);
  const [error, setError] = useState<string | null>(null);
  // 이미지 단계는 Pod 하나에 1~3분이 걸려서 Pod별로 차례로 요청한다. 끝난 Pod부터 바로 화면에 나온다.
  const [progress, setProgress] = useState<{
    pod: string;
    done: number;
    total: number;
  } | null>(null);
  const [queue, setQueueState] = useState<QueuedJob[]>([]);
  const queueRef = useRef<QueuedJob[]>([]);
  const setQueue = (next: QueuedJob[]) => {
    queueRef.current = next;
    setQueueState(next);
  };
  const activeRef = useRef(false); // 서버에서 생성·수정 요청이 도는 중
  const jobId = useRef(0);
  useLeaveWarning(busy !== null || queue.length > 0);
  // 이미지는 한 장씩 끝나는 대로 서버에 저장되므로, 생성 중에는 실행을 다시 읽어 끝난 이미지부터 보여준다
  useRunPolling(step === "image" && busy !== null, run, onChange);

  // 응답이 늦게 도착해도 더 최신 상태(예: 그 사이의 선택)를 되돌리지 않는다
  const latestRun = useRef(run);
  latestRun.current = run;
  const apply = (next: RunState) => {
    if (next.updated_at >= latestRun.current.updated_at) onChange(next);
  };

  const runJob = async (key: BusyKey, action: () => Promise<RunState>, label?: string): Promise<boolean> => {
    setBusy(key);
    setError(null);
    try {
      apply(await action());
      return true;
    } catch (err) {
      setError(label ? `${label}: ${(err as Error).message}` : (err as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const drainQueue = async () => {
    while (queueRef.current.length > 0) {
      const [job, ...rest] = queueRef.current;
      setQueue(rest);
      await runJob(job.key, job.action, job.label);
    }
  };
  // 서버 작업 하나를 돌리고, 끝나면 그동안 쌓인 대기열을 이어서 보낸다
  const exclusive = async (work: () => Promise<boolean>): Promise<boolean> => {
    activeRef.current = true;
    try {
      return await work();
    } finally {
      await drainQueue();
      activeRef.current = false;
    }
  };
  // 다른 작업이 돌고 있으면 대기열에 넣는다 (true = 보냈거나 대기열에 넣음)
  const schedule = (slot: string, label: string, key: BusyKey, action: () => Promise<RunState>): Promise<boolean> => {
    if (activeRef.current) {
      jobId.current += 1;
      setQueue([...queueRef.current, { id: jobId.current, slot, label, key, action }]);
      return Promise.resolve(true);
    }
    return exclusive(() => runJob(key, action));
  };
  const call = (key: string, action: () => Promise<RunState>) => schedule(key, "", key, action);
  // 선택·'그대로 쓰기'는 서버가 최신 상태에 바로 반영하므로 생성 중에도 기다리지 않는다
  const immediate = (action: () => Promise<RunState>) => {
    action().then(apply, (err: Error) => setError(err.message));
  };

  // 안을 고르거나 고치는 것은 뒤 단계 결과를 그대로 둔다 (backend runs.py _apply_change).
  // 단계 전체를 다시 생성할 때만 고를 안이 새로 바뀌므로 뒤 단계가 비워진다.
  const laterSteps = STEP_ORDER.slice(STEP_ORDER.indexOf(step) + 1);
  const hasLaterWork = laterSteps.some((s) => Object.keys(run.steps[s].slots).length > 0) || run.html !== null;
  const confirmReset = () =>
    !hasLaterWork || window.confirm("다시 생성하면 뒤 단계 결과가 초기화됩니다. 계속할까요?");

  const pods = selectedPodOrder(run);
  const multiSlot = step === "image";
  // 이미지 단계는 ①에서 정한 Pod 순서대로, 아직 생성하지 않은 Pod도 자리를 보여준다
  const slotNames = multiSlot ? pods : Object.keys(state.slots);
  const generatedCount = Object.keys(state.slots).length;

  // 이미지 단계에서 아직 생성하지 않은 Pod. 일부만 만든 상태면 남은 Pod만 이어서 만들 수 있다
  const missingPods = multiSlot ? pods.filter((pod) => !state.slots[pod]) : [];

  // Pod를 하나씩 만들고, Pod 사이사이에 대기열(수정 요청 등)을 먼저 보낸다
  const generateEachPod = (key: string, targets: string[]) =>
    exclusive(async () => {
      setError(null);
      try {
        for (const [i, pod] of targets.entries()) {
          setBusy(key);
          setProgress({ pod, done: i, total: targets.length });
          apply(await api.generate(run.id, step, pod));
          setProgress(null);
          await drainQueue();
        }
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      } finally {
        setProgress(null);
        setBusy(null);
      }
    });

  const generateAll = () => {
    if (!confirmReset()) return;
    if (multiSlot) generateEachPod("all", pods);
    else call("all", () => api.generate(run.id, step));
  };
  const generateMissing = () => generateEachPod("missing", missingPods);
  const busyLabel = progress ? `${progress.pod} 생성 중 (${progress.done + 1}/${progress.total})` : "생성 중";

  return (
    <section
      id={`step-${step}`}
      className={`scroll-mt-28 rounded-xl border bg-white p-6 ${locked ? "opacity-50" : ""}`}
    >
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
        <div className="flex items-center gap-2">
          {generatedCount > 0 && missingPods.length > 0 && (
            <button
              onClick={generateMissing}
              disabled={locked || busy !== null}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-40"
            >
              {busy === "missing" ? <Spinner /> : <SparkleIcon />}
              {busy === "missing" ? busyLabel : `남은 Pod 생성 (${missingPods.length}개)`}
            </button>
          )}
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
      </div>

      <StepGuide step={step} run={run} locked={locked} generatedCount={generatedCount} />
      {error && <ErrorMessage message={error} onClose={() => setError(null)} />}

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
            generating={busy === slotName || progress?.pod === slotName}
            queued={queue.filter((job) => job.slot === slotName)}
            onCancelQueued={(id) => setQueue(queueRef.current.filter((job) => job.id !== id))}
            onGenerate={
              multiSlot
                ? (feedback) =>
                    schedule(slotName, feedback ? `요청하며 다시 생성 · ${feedback}` : "다시 생성", slotName, () =>
                      api.generate(run.id, step, slotName, feedback),
                    )
                : null
            }
            onSelect={(index, edited) =>
              multiSlot
                ? immediate(() => api.select(run.id, step, slotName, index, edited))
                : call(slotName, () => api.select(run.id, step, slotName, index, edited))
            }
            onRevise={(index, request, pods) =>
              multiSlot
                ? schedule(slotName, `${index + 1}번 이미지 수정 · ${request}`, `${slotName}#${index}`, () =>
                    api.revise(run.id, step, { slot: slotName, index, request, pods }),
                  )
                : call(slotName, () => api.revise(run.id, step, { slot: slotName, index, request, pods }))
            }
            onKeep={() => immediate(() => api.keepImage(run.id, slotName))}
          />
        ))}
    </section>
  );
}

const FIRST_GUIDE: Record<StepName, string> = {
  pod: "입력한 타겟과 스펙을 보고 AI가 Pod 순서·레이아웃을 방향이 다른 3안으로 만듭니다.",
  copy: "고른 Pod 순서에 맞춰 모든 Pod의 카피를 3안으로 만듭니다.",
  image: "Pod마다 이미지 3안을 만듭니다. 다 만든 이미지부터 한 장씩 바로 나타납니다.",
};

/** 지금 이 단계에서 무엇을 하면 되는지 한 줄로 알려준다. */
function StepGuide({
  step,
  run,
  locked,
  generatedCount,
}: {
  step: StepName;
  run: RunState;
  locked: boolean;
  generatedCount: number;
}) {
  let text: string;
  let next: { href: string; label: string } | null = null;
  if (locked) text = "앞 단계에서 안을 먼저 선택하세요.";
  else if (generatedCount === 0) text = FIRST_GUIDE[step];
  else if (!isStepComplete(run, step)) {
    if (step === "image") {
      const pods = selectedPodOrder(run);
      const chosen = pods.filter((pod) => run.steps.image.slots[pod]?.selected != null).length;
      text = `Pod마다 이미지를 한 장씩 클릭해 고르세요. (${chosen}/${pods.length} 선택) 마음에 들지 않으면 이미지 아래 "수정 요청"을 써 보세요.`;
    } else text = "마음에 드는 안을 클릭해 고르세요. 고른 안이 다음 단계의 입력이 됩니다.";
  } else {
    const nextStep = STEP_ORDER[STEP_ORDER.indexOf(step) + 1];
    text =
      step === "image"
        ? "모든 Pod를 골랐습니다. ④에서 시안을 조립하세요."
        : "선택을 마쳤습니다. 아래에서 직접 고치거나 AI에게 수정을 요청해도 뒤 단계 결과는 그대로 남습니다.";
    next = nextStep
      ? { href: `#step-${nextStep}`, label: `${STEP_LABELS[nextStep]}로 이동` }
      : { href: "#step-render", label: "④ 시안 조립으로 이동" };
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
      <p>{text}</p>
      {next && (
        <a href={next.href} className="font-semibold text-primary hover:text-primary-pressed">
          {next.label} ↓
        </a>
      )}
    </div>
  );
}

interface SlotViewProps {
  step: StepName;
  run: RunState;
  slotName: string;
  title: string | null;
  slot: SlotState<StepName> | null; // 이미지 단계에서 아직 생성하지 않은 Pod는 null
  busy: BusyKey;
  generating: boolean; // 이 슬롯의 안을 만드는 중
  queued: QueuedJob[]; // 이 슬롯에 대해 대기열에 있는 요청
  onCancelQueued: (id: number) => void;
  onGenerate: ((feedback?: string) => Promise<boolean>) | null; // 이미지 단계: 이 Pod만 (요청 반영해) 다시 생성
  onSelect: (index: number, edited?: StepContents[StepName]) => void;
  onRevise: (index: number, request: string, pods?: string[]) => Promise<boolean>;
  onKeep: () => void; // 앞 단계가 바뀌었다는 표시를 지우고 지금 이미지를 그대로 쓴다
}

function SlotView({
  step,
  run,
  slotName,
  title,
  slot,
  busy,
  generating,
  queued,
  onCancelQueued,
  onGenerate,
  onSelect,
  onRevise,
  onKeep,
}: SlotViewProps) {
  // 이미지 단계는 생성 중에도 고르기·수정 요청을 받는다 (요청은 대기열로). POD·카피는 생성이 끝날 때까지 막는다
  const disabled = busy !== null && step !== "image";
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
              {generating && (
                <span className="flex items-center gap-1 text-xs text-gray-500">
                  <Spinner className="h-3.5 w-3.5" /> 생성 중
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

      {queued.length > 0 && (
        <ul className="mt-3 space-y-1">
          {queued.map((job) => (
            <li
              key={job.id}
              className="flex items-center gap-2 rounded-lg border border-dashed bg-gray-50 px-3 py-1.5 text-xs text-gray-600"
            >
              <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600">대기 중</span>
              <span className="min-w-0 flex-1 truncate">{job.label}</span>
              <button
                type="button"
                onClick={() => onCancelQueued(job.id)}
                className="text-gray-400 hover:text-danger"
                aria-label="대기 중인 요청 취소"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {slot && slot.stale.length > 0 && !generating && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <ul className="space-y-0.5">
            {slot.stale.map((note) => (
              <li key={note}>· {note}. 필요하면 이 Pod만 다시 생성하세요.</li>
            ))}
          </ul>
          <button
            onClick={onKeep}
            disabled={disabled}
            className="rounded-full border border-amber-300 bg-white px-3 py-1 hover:bg-amber-100 disabled:opacity-40"
          >
            지금 이미지 그대로 쓰기
          </button>
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
        title &&
        (generating ? (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <PendingCard key={i} />
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-lg bg-gray-100 p-4 text-sm text-gray-500">아직 생성하지 않았습니다.</p>
        ))
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
                  original={selected && slot.edited ? option : null}
                  selected={selected}
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
          {generating &&
            Array.from({ length: slot.pending }, (_, i) => <PendingCard key={`pending-${i}`} />)}
        </div>
      )}

      {slot?.selected != null && step === "copy" && (
        <CopyReviseBox
          key={`revise-${slot.selected}-${run.updated_at}`}
          content={(slot.edited ?? slot.options[slot.selected]).content as CopyContent}
          busy={busy === slotName}
          disabled={disabled}
          onSubmit={(pods, request) => onRevise(slot.selected!, request, pods)}
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

/** 아직 만드는 중인 이미지 자리 */
function PendingCard() {
  return (
    <div className="flex aspect-video items-center justify-center gap-1.5 rounded-xl border border-dashed bg-gray-50 text-sm text-gray-500">
      <Spinner className="h-4 w-4" /> 생성 중
    </div>
  );
}

/** 고른 카피안에서 Pod를 하나 이상(또는 전체) 골라 AI에게 수정을 요청한다. 고르지 않은 Pod는 그대로 둔다. */
function CopyReviseBox({
  content,
  busy,
  disabled,
  onSubmit,
}: {
  content: CopyContent;
  busy: boolean;
  disabled: boolean;
  onSubmit: (pods: string[], request: string) => Promise<boolean>;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const targets = content.pods.filter((p) => chosen.includes(p.pod));
  const all = targets.length === content.pods.length;
  const toggle = (pod: string) =>
    setChosen((prev) => (prev.includes(pod) ? prev.filter((p) => p !== pod) : [...prev, pod]));
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs disabled:opacity-40 ${
      active ? "border-primary bg-primary-soft font-semibold text-primary-pressed" : "bg-white hover:bg-gray-100"
    }`;

  return (
    <div className="mt-5 rounded-lg border p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <PencilIcon className="h-4 w-4 text-primary" />
        카피 수정 요청
      </p>
      <p className="mt-1 text-xs text-gray-500">
        고칠 Pod를 여러 개 고르거나 "전체"를 고르고 요청을 쓰면, AI가 고른 Pod 카피만 다시 씁니다.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setChosen(all ? [] : content.pods.map((p) => p.pod))}
          disabled={disabled}
          className={chip(all)}
        >
          전체
        </button>
        <span className="mx-1 h-4 w-px bg-gray-300" />
        {content.pods.map((p) => (
          <button key={p.pod} onClick={() => toggle(p.pod)} disabled={disabled} className={chip(chosen.includes(p.pod))}>
            {chosen.includes(p.pod) && "✓ "}
            {p.pod}
          </button>
        ))}
      </div>
      {targets.length > 0 && (
        <div className="mt-3 space-y-2">
          <ul className="space-y-1.5 rounded-md bg-gray-100 p-3 text-sm">
            {targets.map((p) => (
              <li key={p.pod}>
                <span className="mr-2 text-xs font-semibold text-primary">{p.pod}</span>
                <span className="font-semibold">{p.headline}</span>
                <p className="text-gray-700">{p.body}</p>
              </li>
            ))}
          </ul>
          <RequestBox
            placeholder="예: 헤드카피를 더 짧고 강하게, 수치를 앞에 두기, 바디에 사용 장면 넣기"
            submitLabel={all ? "전체 카피 수정" : `${targets.length}개 Pod 카피 수정`}
            busy={busy}
            disabled={disabled}
            onSubmit={async (request) => {
              if (await onSubmit(targets.map((p) => p.pod), request)) setChosen([]);
            }}
            onCancel={() => setChosen([])}
          />
        </div>
      )}
    </div>
  );
}
