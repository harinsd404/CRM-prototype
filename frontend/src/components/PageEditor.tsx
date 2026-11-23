import { useEffect, useRef, useState } from "react";
import { api, withBase } from "../api";
import {
  BODY_MAX,
  HEADLINE_MAX,
  LAYOUTS,
  LAYOUT_LABELS,
  LAYOUT_RATIOS,
  selectedOption,
  type Layout,
  type PageEdit,
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
  // 확정 전 시안 (null = 고친 것 없음 → 저장된 시안을 보여 준다)과 확정하지 않은 수정이 있는지
  onDraft: (html: string | null, dirty: boolean) => void;
}

type Text = { headline: string; body: string };
type Item = PodContent["items"][number];

const PREVIEW_DELAY_MS = 400; // 카피를 치는 동안에는 미리보기 조립을 미룬다

function move(items: Item[], from: number, to: number): Item[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** ④ 시안을 앞 단계로 돌아가지 않고 고친다. 고친 값은 확정하기 전까지 저장하지 않고 미리보기에만 보여 준다.
 *  - 확정: ①②③에서 고른 안을 바꾼다 (순서·레이아웃 → ① 수정본, 헤드·바디 → ② 수정본, 이미지 → ③ 다른 안 선택).
 *    단계 화면과 최종 시안이 항상 같은 값을 보여 준다.
 *  - 기존 디자인 유지: 고친 값을 버리고 저장된 시안으로 돌아간다. */
export default function PageEditor({ run, focus, onFocus, onChange, onDraft }: Props) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [texts, setTexts] = useState<Record<PodName, Text>>({});
  const [images, setImages] = useState<Record<PodName, number>>({});
  const [draftRun, setDraftRun] = useState<RunState | null>(null); // 고친 값을 적용해 본 실행 (경고·시안)
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const plan = selectedOption(run, "pod");
  const copy = selectedOption(run, "copy");
  const baseItems = plan?.content.items ?? [];
  const currentItems = items ?? baseItems;

  // 저장된 값과 다른 것만 보낸다
  const edit: PageEdit = {};
  if (items && JSON.stringify(items) !== JSON.stringify(baseItems)) edit.items = items;
  const changedTexts = Object.fromEntries(
    Object.entries(texts).filter(([pod, text]) => {
      const saved = copy?.content.pods.find((p) => p.pod === pod);
      return saved && (saved.headline !== text.headline || saved.body !== text.body);
    }),
  );
  if (Object.keys(changedTexts).length) edit.copy = changedTexts;
  const changedImages = Object.fromEntries(
    Object.entries(images).filter(([pod, index]) => run.steps.image.slots[pod]?.selected !== index),
  );
  if (Object.keys(changedImages).length) edit.images = changedImages;
  const editKey = JSON.stringify(edit);
  const dirty = editKey !== "{}";
  const changeCount = (edit.items ? 1 : 0) + Object.keys(changedTexts).length + Object.keys(changedImages).length;

  // 고칠 때마다 서버가 저장 없이 조립한 시안으로 미리보기를 바꾼다. 늦게 온 응답이 최신 결과를 덮지 않게 번호로 거른다
  useEffect(() => {
    const id = ++requestId.current;
    if (!dirty) {
      setDraftRun(null);
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.previewPage(run.id, JSON.parse(editKey));
        if (id !== requestId.current) return;
        setDraftRun(result);
        setError(null);
      } catch (err) {
        if (id === requestId.current) setError((err as Error).message);
      } finally {
        if (id === requestId.current) setPreviewing(false);
      }
    }, PREVIEW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [editKey, run.id, run.updated_at, dirty]);

  const notify = useRef(onDraft);
  notify.current = onDraft;
  useEffect(() => {
    notify.current(dirty ? (draftRun?.html ?? null) : null, dirty);
  }, [dirty, draftRun]);

  if (!plan || !copy) return null;

  const jobRunning = run.job != null && run.job.error == null;
  const disabled = saving || jobRunning;
  // 경고·알림은 고친 값을 적용해 본 결과로 보여 준다 (아직 안 왔으면 저장된 값)
  const view = (dirty && draftRun) || run;
  const viewPlan = selectedOption(view, "pod") ?? plan;
  const viewCopy = selectedOption(view, "copy") ?? copy;

  const discard = () => {
    setItems(null);
    setTexts({});
    setImages({});
    setError(null);
  };

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      onChange(await api.savePage(run.id, edit));
      discard();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const keepImage = async (pod: PodName) => {
    setSaving(true);
    try {
      onChange(await api.keepImage(run.id, pod));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setLayout = (index: number, layout: Layout) =>
    setItems(currentItems.map((item, i) => (i === index ? { ...item, layout } : item)));

  // [Pod]로 시작하는 경고는 그 Pod 카드에, 나머지(순서·유형 분포 등)는 맨 위에 보여 준다
  const podWarnings = (pod: PodName) =>
    viewCopy.warnings.filter((w) => w.startsWith(`[${pod}] `)).map((w) => w.slice(pod.length + 3));
  const pageWarnings = [...viewPlan.warnings, ...viewCopy.warnings.filter((w) => !w.startsWith("["))];

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 space-y-2 rounded-lg border bg-white p-3 shadow-sm">
        <p className="text-xs text-gray-600">
          {dirty
            ? `확정하지 않은 수정 ${changeCount}건${previewing ? " · 미리보기 조립 중…" : " · 왼쪽은 확정 전 미리보기입니다"}`
            : "고친 내용은 확정하기 전까지 저장되지 않습니다."}
        </p>
        <div className="flex gap-2">
          <button
            onClick={discard}
            disabled={!dirty || saving}
            className="flex-1 rounded-lg border bg-white px-3 py-2 text-sm hover:bg-gray-100 disabled:opacity-40"
          >
            기존 디자인 유지
          </button>
          <button
            onClick={confirm}
            disabled={!dirty || disabled || previewing || error != null}
            className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-40"
          >
            {saving ? "저장 중…" : "확정"}
          </button>
        </div>
      </div>

      {jobRunning && <p className="rounded-lg bg-gray-100 p-3 text-sm text-gray-600">생성이 끝나면 고칠 수 있습니다.</p>}
      {error && <ErrorMessage message={error} onClose={() => setError(null)} />}
      {pageWarnings.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-warning-soft p-3 text-xs text-warning">
          {pageWarnings.map((w) => (
            <li key={w}>· {w}</li>
          ))}
        </ul>
      )}

      {currentItems.map((item, i) => {
        const pod = item.pod;
        const saved = copy.content.pods.find((p) => p.pod === pod);
        const text = texts[pod] ?? (saved ? { headline: saved.headline, body: saved.body } : null);
        const image = run.steps.image.slots[pod];
        const chosenImage = images[pod] ?? image?.selected;
        const stale = view.steps.image.slots[pod]?.stale ?? [];
        const sameAsPrevious = i > 0 && currentItems[i - 1].layout === item.layout;
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
                  onClick={() => setItems(move(currentItems, i, i - 1))}
                  className="rounded border bg-white px-1.5 text-xs hover:bg-gray-100 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`${pod} 아래로`}
                  disabled={disabled || i === currentItems.length - 1}
                  onClick={() => setItems(move(currentItems, i, i + 1))}
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

            {text && (
              <div className="space-y-1">
                <p className="text-xs text-gray-500">카피</p>
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`${pod} 헤드카피`}
                    value={text.headline}
                    disabled={disabled}
                    onChange={(e) => setTexts((prev) => ({ ...prev, [pod]: { ...text, headline: e.target.value } }))}
                    className="min-w-0 flex-1 rounded border bg-white px-2 py-1 text-sm font-semibold"
                  />
                  <Count length={text.headline.length} max={HEADLINE_MAX} />
                </div>
                <div className="flex items-start gap-2">
                  <textarea
                    aria-label={`${pod} 바디카피`}
                    value={text.body}
                    disabled={disabled}
                    rows={3}
                    onChange={(e) => setTexts((prev) => ({ ...prev, [pod]: { ...text, body: e.target.value } }))}
                    className="min-w-0 flex-1 rounded border bg-white px-2 py-1 text-sm"
                  />
                  <Count length={text.body.length} max={BODY_MAX} />
                </div>
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
                    const chosen = chosenImage === index;
                    return (
                      <button
                        key={index}
                        type="button"
                        disabled={disabled || chosen}
                        onClick={() => setImages((prev) => ({ ...prev, [pod]: index }))}
                        title={`${index + 1}안 · ${option.content.brief.ratio}${fits ? "" : ` (${item.layout}에 맞지 않는 화면비)`}`}
                        className={`relative overflow-hidden rounded border-2 disabled:cursor-default ${
                          chosen ? "border-primary" : "border-transparent hover:border-gray-400"
                        }`}
                      >
                        <img
                          src={withBase(option.content.image_url)}
                          alt={`${pod} ${index + 1}안`}
                          className="aspect-square w-full object-cover"
                        />
                        <span
                          className={`absolute bottom-0 left-0 right-0 px-1 text-[10px] text-white ${
                            fits ? "bg-black/50" : "bg-danger"
                          }`}
                        >
                          {option.content.brief.ratio}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {stale.length > 0 && (
                  <div className="mt-2 rounded bg-warning-soft p-2 text-xs text-warning">
                    {stale.map((note) => (
                      <p key={note}>· {note}</p>
                    ))}
                    {/* 알림 지우기는 바로 저장된다. 확정 전 수정이 있으면 알림이 다시 계산되므로 확정한 뒤에 쓴다 */}
                    {!dirty && (
                      <button
                        onClick={() => keepImage(pod)}
                        disabled={disabled}
                        className="mt-1 underline hover:text-gray-900 disabled:opacity-40"
                      >
                        지금 이미지 그대로 쓰기
                      </button>
                    )}
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
