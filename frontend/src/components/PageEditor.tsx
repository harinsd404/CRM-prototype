import { useState } from "react";
import { api, withBase } from "../api";
import {
  BODY_MAX,
  HEADLINE_MAX,
  LAYOUTS,
  LAYOUT_LABELS,
  LAYOUT_RATIOS,
  MAIN_SLOT,
  selectedOption,
  type Layout,
  type PodContent,
  type PodName,
  type RunState,
} from "../types";
import { Count } from "./CopyEditBox";
import ErrorMessage from "./ErrorMessage";
import LayoutIcon from "./LayoutIcon";

interface Props {
  run: RunState;
  focus: PodName | null; // 미리보기에서 보고 있는 Pod
  onFocus: (pod: PodName) => void;
  onChange: (run: RunState) => void;
}

type Draft = { headline: string; body: string };
type Item = PodContent["items"][number];

function move(items: Item[], from: number, to: number): Item[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** ④ 시안을 앞 단계로 돌아가지 않고 고친다. 고친 값은 ①②③에서 고른 안에 그대로 저장되고(선택·직접 수정 API),
 *  서버가 시안을 바로 다시 조립한다. 그래서 단계 화면과 최종 시안이 항상 같은 값을 보여 준다.
 *  - 순서·레이아웃 → ① 고른 안의 수정본  - 헤드·바디 → ② 고른 안의 수정본  - 이미지 → ③ 그 Pod에서 다른 안 선택 */
export default function PageEditor({ run, focus, onFocus, onChange }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<PodName, Draft>>({});

  const plan = selectedOption(run, "pod");
  const copy = selectedOption(run, "copy");
  const podIndex = run.steps.pod.slots[MAIN_SLOT]?.selected;
  const copyIndex = run.steps.copy.slots[MAIN_SLOT]?.selected;
  if (!plan || !copy || podIndex == null || copyIndex == null) return null;

  const jobRunning = run.job != null && run.job.error == null;
  const disabled = saving || jobRunning;
  const items = plan.content.items;

  const save = async (action: () => Promise<RunState>) => {
    setSaving(true);
    setError(null);
    try {
      onChange(await action());
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const savePlan = (next: Item[]) => save(() => api.select(run.id, "pod", MAIN_SLOT, podIndex, { ...plan.content, items: next }));

  const setLayout = (index: number, layout: Layout) =>
    savePlan(items.map((item, i) => (i === index ? { ...item, layout } : item)));

  const saveCopy = async (pod: PodName) => {
    const draft = drafts[pod];
    if (!draft) return;
    const pods = copy.content.pods.map((p) => (p.pod === pod ? { ...p, ...draft } : p));
    const ok = await save(() => api.select(run.id, "copy", MAIN_SLOT, copyIndex, { ...copy.content, pods }));
    if (ok) dropDraft(pod);
  };

  const dropDraft = (pod: PodName) =>
    setDrafts((prev) => {
      const { [pod]: _, ...rest } = prev;
      return rest;
    });

  // 칸마다 [Pod]로 시작하는 경고는 그 Pod 카드에, 나머지(순서·유형 분포 등)는 맨 위에 보여 준다
  const podWarnings = (pod: PodName) =>
    copy.warnings.filter((w) => w.startsWith(`[${pod}] `)).map((w) => w.slice(pod.length + 3));
  const pageWarnings = [...plan.warnings, ...copy.warnings.filter((w) => !w.startsWith("["))];

  return (
    <div className="space-y-3">
      {jobRunning && <p className="rounded-lg bg-gray-100 p-3 text-sm text-gray-600">생성이 끝나면 고칠 수 있습니다.</p>}
      {error && <ErrorMessage message={error} onClose={() => setError(null)} />}
      {pageWarnings.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-warning-soft p-3 text-xs text-warning">
          {pageWarnings.map((w) => (
            <li key={w}>· {w}</li>
          ))}
        </ul>
      )}

      {items.map((item, i) => {
        const pod = item.pod;
        const current = copy.content.pods.find((p) => p.pod === pod);
        const draft = drafts[pod] ?? (current ? { headline: current.headline, body: current.body } : null);
        const dirty = drafts[pod] != null && (draft?.headline !== current?.headline || draft?.body !== current?.body);
        const image = run.steps.image.slots[pod];
        const sameAsPrevious = i > 0 && items[i - 1].layout === item.layout;
        const warnings = podWarnings(pod);

        return (
          <article
            key={pod}
            onClick={() => onFocus(pod)}
            onFocusCapture={() => onFocus(pod)}
            className={`space-y-3 rounded-lg border bg-white p-4 ${focus === pod ? "border-primary ring-1 ring-primary" : ""}`}
          >
            <header className="flex items-center gap-2">
              <span className="w-5 text-sm font-semibold text-gray-500">{i + 1}</span>
              <span className="text-sm font-semibold text-ink">{pod}</span>
              <span className="ml-auto flex gap-1">
                <button
                  type="button"
                  aria-label={`${pod} 위로`}
                  disabled={disabled || i === 0}
                  onClick={() => savePlan(move(items, i, i - 1))}
                  className="rounded border bg-white px-1.5 text-xs hover:bg-gray-100 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`${pod} 아래로`}
                  disabled={disabled || i === items.length - 1}
                  onClick={() => savePlan(move(items, i, i + 1))}
                  className="rounded border bg-white px-1.5 text-xs hover:bg-gray-100 disabled:opacity-30"
                >
                  ↓
                </button>
              </span>
            </header>

            <div>
              <p className="mb-1 text-xs text-gray-500">레이아웃</p>
              <div className="flex flex-wrap gap-1">
                {LAYOUTS.map((layout) => (
                  <button
                    key={layout}
                    type="button"
                    title={LAYOUT_LABELS[layout]}
                    disabled={disabled || item.layout === layout}
                    onClick={() => setLayout(i, layout)}
                    className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs disabled:cursor-default ${
                      item.layout === layout
                        ? sameAsPrevious
                          ? "border-danger bg-danger-soft font-semibold text-danger-strong"
                          : "border-primary bg-primary-soft font-semibold text-primary-pressed"
                        : "bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                    }`}
                  >
                    <LayoutIcon layout={layout} />
                    {layout}
                  </button>
                ))}
              </div>
              {sameAsPrevious && <p className="mt-1 text-xs text-danger">바로 위 Pod와 레이아웃이 같습니다.</p>}
            </div>

            {draft && (
              <div className="space-y-1">
                <p className="text-xs text-gray-500">카피</p>
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`${pod} 헤드카피`}
                    value={draft.headline}
                    disabled={disabled}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [pod]: { ...draft, headline: e.target.value } }))}
                    className="min-w-0 flex-1 rounded border bg-white px-2 py-1 text-sm font-semibold"
                  />
                  <Count length={draft.headline.length} max={HEADLINE_MAX} />
                </div>
                <div className="flex items-start gap-2">
                  <textarea
                    aria-label={`${pod} 바디카피`}
                    value={draft.body}
                    disabled={disabled}
                    rows={3}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [pod]: { ...draft, body: e.target.value } }))}
                    className="min-w-0 flex-1 rounded border bg-white px-2 py-1 text-sm"
                  />
                  <Count length={draft.body.length} max={BODY_MAX} />
                </div>
                {dirty && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => saveCopy(pod)}
                      disabled={disabled}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-40"
                    >
                      카피 적용
                    </button>
                    <button
                      onClick={() => dropDraft(pod)}
                      disabled={disabled}
                      className="rounded-lg border bg-white px-3 py-1.5 text-xs hover:bg-gray-100 disabled:opacity-40"
                    >
                      되돌리기
                    </button>
                  </div>
                )}
                {warnings.length > 0 && (
                  <ul className="space-y-0.5 pt-1 text-xs text-warning">
                    {warnings.map((w) => (
                      <li key={w}>· {w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {image && image.options.length > 0 && (
              <div>
                <p className="mb-1 text-xs text-gray-500">이미지 (③에서 만든 안)</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {image.options.map((option, index) => {
                    const fits = LAYOUT_RATIOS[item.layout].includes(option.content.brief.ratio);
                    const chosen = image.selected === index;
                    return (
                      <button
                        key={index}
                        type="button"
                        disabled={disabled || chosen}
                        onClick={() => save(() => api.select(run.id, "image", pod, index))}
                        title={`${index + 1}안 · ${option.content.brief.ratio}${fits ? "" : ` (${item.layout}에 맞지 않는 화면비)`}`}
                        className={`relative overflow-hidden rounded border-2 disabled:cursor-default ${
                          chosen ? "border-primary" : "border-transparent hover:border-gray-400"
                        }`}
                      >
                        <img src={withBase(option.content.image_url)} alt={`${pod} ${index + 1}안`} className="aspect-square w-full object-cover" />
                        <span
                          className={`absolute bottom-0 left-0 right-0 px-1 text-[10px] ${
                            fits ? "bg-black/50 text-white" : "bg-danger text-white"
                          }`}
                        >
                          {option.content.brief.ratio}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {image.stale.length > 0 && (
                  <div className="mt-2 rounded bg-warning-soft p-2 text-xs text-warning">
                    {image.stale.map((note) => (
                      <p key={note}>· {note}</p>
                    ))}
                    <button
                      onClick={() => save(() => api.keepImage(run.id, pod))}
                      disabled={disabled}
                      className="mt-1 underline hover:text-gray-900 disabled:opacity-40"
                    >
                      지금 이미지 그대로 쓰기
                    </button>
                  </div>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
