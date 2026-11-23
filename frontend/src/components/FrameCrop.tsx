import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_ADJUST, adjustStyle, sameAdjust, type ImageAdjust, type PodName } from "../types";

interface Props {
  frame: HTMLIFrameElement | null; // 시안 미리보기 iframe (같은 출처라 안쪽 DOM을 바로 다룬다)
  frameVersion: number; // iframe이 새로 열릴 때마다 바뀐다. 그때마다 이벤트를 다시 붙인다
  toolbarHost: HTMLElement | null; // 미리보기 위에 띄우는 조정 툴바 자리
  target: PodName | null; // 조정 중인 Pod (null = 조정 안 함)
  value: ImageAdjust; // 조정 중인 이미지의 지금 값
  disabled: boolean;
  onPick: (pod: PodName) => void; // 시안 속 이미지를 눌렀다
  onChange: (adjust: ImageAdjust) => void;
  onDone: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const BLUE = "#2189ff";
const STYLE_ID = "crm-edit-style";
const OVERLAY_ID = "crm-crop";
// iframe 안에 넣는 편집용 스타일. 저장되는 시안에는 들어가지 않는다
// 테두리는 이미지 위에 덮는 층으로 그린다 (L3는 이미지가 absolute라 outline을 덮는다)
const EDIT_CSS = `
  section[data-pod] .media { cursor: pointer; }
  section[data-pod] .media::after { content: ""; position: absolute; inset: 0; z-index: 3; pointer-events: none; }
  section[data-pod] .media:hover::after { border: 4px dashed rgba(33,137,255,.9); }
  #${OVERLAY_ID} img { user-select: none; -webkit-user-drag: none; }
`;

type Rect = { left: number; top: number; width: number; height: number };
type Corner = "nw" | "ne" | "sw" | "se";
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/* 저장 형식(ImageAdjust)은 초점(x, y %)을 중심으로 z배 확대한 것이다. 화면에서는 같은 것을
 * "칸(frame)을 덮는 사진의 위치·크기"로 다룬다: 사진 = 칸 × z, 왼쪽 끝 = 칸 왼쪽 − x% × (사진 폭 − 칸 폭).
 * x, y가 0~100이면 사진이 칸을 항상 꽉 덮는다 (빈 곳이 생기지 않는다). */
function imageRect(frame: Rect, a: ImageAdjust): Rect {
  const width = frame.width * a.zoom;
  const height = frame.height * a.zoom;
  return {
    left: frame.left - (a.x / 100) * (width - frame.width),
    top: frame.top - (a.y / 100) * (height - frame.height),
    width,
    height,
  };
}

/** 사진의 배율과 왼쪽 위 위치 → 저장 형식. 칸을 벗어나 빈 곳이 생기는 위치는 칸에 맞춰 당긴다 */
function adjustFromRect(frame: Rect, zoom: number, left: number, top: number): ImageAdjust {
  const spanX = frame.width * zoom - frame.width;
  const spanY = frame.height * zoom - frame.height;
  const x = spanX > 0.5 ? ((frame.left - clamp(left, frame.left - spanX, frame.left)) / spanX) * 100 : 50;
  const y = spanY > 0.5 ? ((frame.top - clamp(top, frame.top - spanY, frame.top)) / spanY) * 100 : 50;
  return { zoom: round2(zoom), x: round1(x), y: round1(y) };
}

function findMedia(doc: Document, pod: PodName) {
  return doc.querySelector<HTMLElement>(`section[data-pod="${CSS.escape(pod)}"] .media`);
}

/** 문서 좌표의 사진 칸 */
function mediaRect(doc: Document, media: HTMLElement): Rect {
  const r = media.getBoundingClientRect();
  const win = doc.defaultView!;
  return { left: r.left + win.scrollX, top: r.top + win.scrollY, width: r.width, height: r.height };
}

function place(el: HTMLElement, r: Rect) {
  Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
}

/** 시안 미리보기에서 사진을 직접 조정한다 (파워포인트·Canva의 사진 자르기처럼).
 *  사진을 누르면 조정이 켜지고, 칸 밖으로 넘친 부분이 반투명하게 보인다.
 *  사진을 끌면 위치가, 모서리를 끌면 크기가(비율 고정, 반대쪽 모서리 기준) 바뀐다. 휠·툴바로도 확대할 수 있다. */
export default function FrameCrop({ frame, frameVersion, toolbarHost, target, value, disabled, onPick, onChange, onDone }: Props) {
  const [needZoom, setNeedZoom] = useState(false); // 키우지 않고 끌었다 → 툴바에 안내
  const latest = useRef({ value, disabled, target, onPick, onChange, onDone });
  latest.current = { value, disabled, target, onPick, onChange, onDone };
  const draw = useRef<(() => void) | null>(null);

  // 사진을 누르면 그 Pod의 조정을 켜고, 사진 밖을 누르면 끝낸다
  useEffect(() => {
    const doc = frame?.contentDocument;
    if (!doc?.head) return;
    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement("style");
      style.id = STYLE_ID;
      style.textContent = EDIT_CSS;
      doc.head.appendChild(style);
    }
    const click = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (el?.closest(`#${OVERLAY_ID}`)) return; // 조정 중인 사진을 끌고 놓았다
      const pod = el?.closest(".media")?.closest<HTMLElement>("section[data-pod]")?.dataset.pod;
      if (pod && !latest.current.disabled) latest.current.onPick(pod);
      else if (latest.current.target) latest.current.onDone();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && latest.current.onDone();
    doc.addEventListener("click", click);
    doc.addEventListener("keydown", key);
    return () => {
      doc.removeEventListener("click", click);
      doc.removeEventListener("keydown", key);
    };
  }, [frame, frameVersion]);

  // 조정 중인 사진 위에 편집 층을 띄운다: 넘친 부분(반투명) + 칸 테두리 + 사진 테두리 + 모서리 손잡이 4개
  useEffect(() => {
    const doc = frame?.contentDocument;
    const media = target && doc ? findMedia(doc, target) : null;
    const src = media?.querySelector("img")?.getAttribute("src");
    if (!doc || !media || !src) return;
    setNeedZoom(false);

    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration>) => {
      const el = doc.createElement(tag);
      Object.assign(el.style, { position: "absolute", boxSizing: "border-box" }, style);
      return el;
    };
    // 사진이 페이지 밖으로 넘쳐도 가로 스크롤이 생기지 않게 문서 크기로 자른다
    const root = make("div", {
      left: "0",
      top: "0",
      width: "100%",
      height: `${doc.documentElement.scrollHeight}px`,
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "2147483000",
    });
    root.id = OVERLAY_ID;
    // 실제 사진처럼 object-fit: cover로 채운다. 사진 비율이 칸과 달라도(예: L3 칸에 4:3 사진) 칸 안 모습과 어긋나지 않는다
    const ghost = make("img", {
      opacity: "0.45",
      objectFit: "cover",
      pointerEvents: "auto",
      cursor: "grab",
      touchAction: "none",
    });
    ghost.src = src;
    ghost.draggable = false;
    ghost.alt = "";
    const outline = make("div", { borderStyle: "solid", borderColor: "rgba(33,137,255,.9)", pointerEvents: "none" });
    const window_ = make("div", { borderStyle: "solid", borderColor: BLUE, pointerEvents: "auto", cursor: "grab", touchAction: "none" });
    const handles = Object.fromEntries(
      CORNERS.map((corner) => {
        const handle = make("div", {
          background: "#fff",
          borderStyle: "solid",
          borderColor: BLUE,
          boxShadow: "0 1px 4px rgba(0,0,0,.35)",
          pointerEvents: "auto",
          touchAction: "none",
          cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
        });
        handle.dataset.corner = corner;
        return [corner, handle];
      }),
    ) as Record<Corner, HTMLDivElement>;
    root.append(ghost, outline, window_, ...CORNERS.map((c) => handles[c]));
    doc.body.appendChild(root);

    draw.current = () => {
      // 미리보기는 패널 폭에 맞춰 축소되어 있다. 테두리·손잡이는 화면에서 늘 같은 크기로 보이게 그 배율로 나눈다
      const scale = frame.getBoundingClientRect().width / (frame.offsetWidth || 1) || 1;
      const px = (n: number) => `${n / scale}px`;
      outline.style.borderWidth = px(1.5);
      window_.style.borderWidth = px(3);
      for (const corner of CORNERS) {
        Object.assign(handles[corner].style, {
          width: px(16),
          height: px(16),
          marginLeft: px(-8),
          marginTop: px(-8),
          borderWidth: px(2.5),
          borderRadius: px(4),
        });
      }
      const f = mediaRect(doc, media);
      const current = latest.current.value;
      const r = imageRect(f, current);
      place(ghost, r);
      ghost.style.objectPosition = `${current.x}% ${current.y}%`;
      place(outline, r);
      place(window_, f);
      // 넘친 부분만 반투명하게: 칸 자리를 구멍으로 뚫는다 (칸 안은 실제 시안이 보인다)
      const [hx, hy] = [f.left - r.left, f.top - r.top];
      ghost.style.clipPath = `path(evenodd, "M0 0H${r.width}V${r.height}H0Z M${hx} ${hy}h${f.width}v${f.height}h${-f.width}Z")`;
      // 손잡이가 페이지 밖으로 나가면 잡을 수 없으므로 보이는 곳 안에 둔다
      const margin = 10 / scale;
      const maxX = doc.documentElement.clientWidth - margin;
      const maxY = doc.documentElement.scrollHeight - margin;
      for (const corner of CORNERS) {
        const x = corner.endsWith("w") ? r.left : r.left + r.width;
        const y = corner.startsWith("n") ? r.top : r.top + r.height;
        Object.assign(handles[corner].style, { left: `${clamp(x, margin, maxX)}px`, top: `${clamp(y, margin, maxY)}px` });
      }
    };
    draw.current();

    type Drag =
      | { mode: "move"; px: number; py: number; frame: Rect; start: Rect; zoom: number }
      | { mode: "resize"; corner: Corner; ax: number; ay: number; frame: Rect };
    let drag: Drag | null = null;

    const down = (e: PointerEvent) => {
      if (e.button !== 0 || latest.current.disabled) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const f = mediaRect(doc, media);
      const r = imageRect(f, latest.current.value);
      const corner = (e.currentTarget as HTMLElement).dataset.corner as Corner | undefined;
      if (corner) {
        // 반대쪽 모서리를 고정하고 늘린다
        const ax = corner.endsWith("w") ? r.left + r.width : r.left;
        const ay = corner.startsWith("n") ? r.top + r.height : r.top;
        drag = { mode: "resize", corner, ax, ay, frame: f };
      } else {
        drag = { mode: "move", px: e.pageX, py: e.pageY, frame: f, start: r, zoom: latest.current.value.zoom };
      }
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      let next: ImageAdjust;
      if (drag.mode === "move") {
        if (drag.zoom <= MIN_ZOOM + 0.001) {
          setNeedZoom(true);
          return;
        }
        next = adjustFromRect(drag.frame, drag.zoom, drag.start.left + e.pageX - drag.px, drag.start.top + e.pageY - drag.py);
      } else {
        const { corner, ax, ay, frame: f } = drag;
        const sx = (corner.endsWith("w") ? ax - e.pageX : e.pageX - ax) / f.width;
        const sy = (corner.startsWith("n") ? ay - e.pageY : e.pageY - ay) / f.height;
        const zoom = clamp(Math.max(sx, sy), MIN_ZOOM, MAX_ZOOM);
        const left = corner.endsWith("w") ? ax - f.width * zoom : ax;
        const top = corner.startsWith("n") ? ay - f.height * zoom : ay;
        next = adjustFromRect(f, zoom, left, top);
        setNeedZoom(false);
      }
      if (!sameAdjust(next, latest.current.value)) latest.current.onChange(next);
    };
    const up = () => {
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      if (latest.current.disabled) return;
      e.preventDefault(); // 시안이 스크롤되지 않게
      const current = latest.current.value;
      const zoom = round2(clamp(current.zoom - e.deltaY * 0.002, MIN_ZOOM, MAX_ZOOM));
      if (zoom !== current.zoom) {
        setNeedZoom(false);
        latest.current.onChange({ ...current, zoom });
      }
    };
    const reset = () => !latest.current.disabled && latest.current.onChange(DEFAULT_ADJUST);

    for (const el of [ghost, window_, ...CORNERS.map((c) => handles[c])]) el.addEventListener("pointerdown", down);
    for (const el of [ghost, window_]) {
      el.addEventListener("wheel", wheel, { passive: false });
      el.addEventListener("dblclick", reset);
    }
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", up);
    return () => {
      draw.current = null;
      root.remove();
    };
  }, [frame, frameVersion, target]);

  // 값이 바뀌면 서버가 다시 조립하기 전에 보이는 사진과 편집 층에 바로 입힌다
  useEffect(() => {
    const doc = frame?.contentDocument;
    const img = target && doc ? findMedia(doc, target)?.querySelector("img") : null;
    if (img) Object.assign(img.style, adjustStyle(value));
    draw.current?.();
  }, [frame, frameVersion, target, value]);

  // 카드의 버튼으로 켰으면 포커스가 바깥 페이지에 있으므로, Esc는 바깥에서도 받는다
  useEffect(() => {
    if (!target) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && latest.current.onDone();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [target]);

  if (!target || !toolbarHost) return null;
  const percent = Math.round(value.zoom * 100);
  const setZoom = (zoom: number) => {
    setNeedZoom(false);
    onChange({ ...value, zoom: round2(clamp(zoom, MIN_ZOOM, MAX_ZOOM)) });
  };

  return createPortal(
    <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-gray-900/90 px-3 py-2 text-xs text-white shadow-lg">
      <span className="font-semibold">{target} 사진</span>
      <span className="text-gray-300">
        {needZoom
          ? "모서리를 끌어 사진을 키우면 위치를 옮길 수 있습니다"
          : "사진을 끌어 위치 · 모서리를 끌어 크기 · 두 번 눌러 원래대로"}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          aria-label="작게"
          onClick={() => setZoom(value.zoom - 0.1)}
          disabled={disabled || value.zoom <= MIN_ZOOM}
          className="h-6 w-6 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30"
        >
          −
        </button>
        <input
          type="range"
          aria-label="크기"
          min={MIN_ZOOM * 100}
          max={MAX_ZOOM * 100}
          step={5}
          value={percent}
          disabled={disabled}
          onChange={(e) => setZoom(Number(e.target.value) / 100)}
          className="w-28 accent-primary"
        />
        <button
          type="button"
          aria-label="크게"
          onClick={() => setZoom(value.zoom + 0.1)}
          disabled={disabled || value.zoom >= MAX_ZOOM}
          className="h-6 w-6 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30"
        >
          +
        </button>
        <span className="w-10 text-right tabular-nums">{percent}%</span>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_ADJUST)}
          disabled={disabled || sameAdjust(value, DEFAULT_ADJUST)}
          className="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-30"
        >
          원래대로
        </button>
        <button type="button" onClick={onDone} className="rounded bg-primary px-3 py-1 font-semibold hover:bg-primary-hover">
          완료
        </button>
      </span>
    </div>,
    toolbarHost,
  );
}
