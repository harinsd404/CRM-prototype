import { useState, type DragEvent } from "react";
import { LAYOUTS, LAYOUT_LABELS, type Layout, type PodContent } from "../types";
import LayoutIcon from "./LayoutIcon";

interface Props {
  content: PodContent;
  disabled: boolean;
  onSave: (edited: PodContent) => void;
}

type Item = PodContent["items"][number];

function move(items: Item[], from: number, to: number): Item[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** 선택한 ①안을 블록처럼 고친다: 드래그(또는 ↑↓)로 Pod 순서를 바꾸고, Pod마다 레이아웃을 고른다.
 *  저장하면 백엔드가 같은 규칙(1순위 중복, 이동 Pod 수, 레이아웃 연속·종류)으로 다시 검사한다. */
export default function PodEditBox({ content, disabled, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(content.items);
  const [dragging, setDragging] = useState<number | null>(null);
  const changed = JSON.stringify(items) !== JSON.stringify(content.items);

  const setLayout = (index: number, layout: Layout) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, layout } : item)));

  const onDragOver = (e: DragEvent, index: number) => {
    e.preventDefault();
    if (dragging === null || dragging === index) return;
    setItems((prev) => move(prev, dragging, index));
    setDragging(index);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-4 text-sm text-gray-500 underline hover:text-gray-900">
        순서 · 레이아웃 직접 바꾸기
      </button>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border bg-gray-50 p-4">
      <p className="text-xs text-gray-500">블록을 끌어서 순서를 바꾸고, 오른쪽에서 레이아웃을 고르세요. 위에서부터 페이지에 놓이는 순서입니다.</p>
      <ol className="space-y-2">
        {items.map((item, i) => {
          const sameAsPrevious = i > 0 && items[i - 1].layout === item.layout;
          return (
            <li
              key={item.pod}
              draggable={!disabled}
              onDragStart={() => setDragging(i)}
              onDragOver={(e) => onDragOver(e, i)}
              onDragEnd={() => setDragging(null)}
              className={`flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3 transition ${
                dragging === i ? "border-primary opacity-60 shadow-md" : "hover:border-gray-400"
              } ${disabled ? "" : "cursor-grab active:cursor-grabbing"}`}
            >
              <span className="select-none text-gray-400" aria-hidden>
                ⋮⋮
              </span>
              <span className="w-5 text-sm font-semibold text-gray-500">{i + 1}</span>
              <span className="w-24 text-sm font-semibold text-ink">{item.pod}</span>
              <span className="flex gap-1">
                <button
                  type="button"
                  aria-label={`${item.pod} 위로`}
                  disabled={disabled || i === 0}
                  onClick={() => setItems((prev) => move(prev, i, i - 1))}
                  className="rounded border bg-white px-1.5 text-xs hover:bg-gray-100 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`${item.pod} 아래로`}
                  disabled={disabled || i === items.length - 1}
                  onClick={() => setItems((prev) => move(prev, i, i + 1))}
                  className="rounded border bg-white px-1.5 text-xs hover:bg-gray-100 disabled:opacity-30"
                >
                  ↓
                </button>
              </span>
              <span className="ml-auto flex gap-1">
                {LAYOUTS.map((layout) => (
                  <button
                    key={layout}
                    type="button"
                    title={LAYOUT_LABELS[layout]}
                    disabled={disabled}
                    onClick={() => setLayout(i, layout)}
                    className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs ${
                      item.layout === layout
                        ? sameAsPrevious
                          ? "border-danger bg-danger-soft font-semibold text-danger-strong"
                          : "border-primary bg-primary-soft font-semibold text-primary-pressed"
                        : "bg-white text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    <LayoutIcon layout={layout} />
                    {layout}
                  </button>
                ))}
              </span>
              {sameAsPrevious && (
                <p className="w-full text-right text-xs text-danger">바로 위 Pod와 레이아웃이 같습니다.</p>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex gap-2">
        <button
          onClick={() => onSave({ ...content, items })}
          disabled={disabled || !changed}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-40"
        >
          수정 저장
        </button>
        <button
          onClick={() => {
            setItems(content.items);
            setOpen(false);
          }}
          className="rounded-lg border bg-white px-4 py-2 text-sm hover:bg-gray-100"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
