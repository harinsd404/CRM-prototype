import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { STEP_ORDER, isStepComplete, type PodName, type RunState } from "../types";
import ErrorMessage from "./ErrorMessage";
import PageEditor from "./PageEditor";

const PAGE_WIDTH = 1440; // 시안 템플릿의 고정 폭
const FRAME_HEIGHT = 900; // 화면에 보이는 미리보기 높이. 시안은 iframe 안에서 세로로 스크롤한다

interface Props {
  run: RunState;
  onChange: (run: RunState) => void;
}

/** ④ 최종 시안: 선택된 결과를 템플릿으로 조립하고 iframe으로 미리 본다. 수정 모드에서는 옆에서 바로 고친다 (PageEditor). */
export default function HtmlPreview({ run, onChange }: Props) {
  const ready = STEP_ORDER.every((step) => isStepComplete(run, step));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState(true); // 패널 폭에 맞춰 축소 / 실제 크기(가로 스크롤)
  const sectionRef = useRef<HTMLElement>(null);
  const frameBoxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(PAGE_WIDTH);
  const [editing, setEditing] = useState(false);
  const [focus, setFocus] = useState<PodName | null>(null); // 수정 중인 Pod. 미리보기를 그 섹션으로 옮긴다
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const box = frameBoxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
    observer.observe(box);
    return () => observer.disconnect();
  }, [run.html, editing]);
  const scale = fit ? Math.min(1, boxWidth / PAGE_WIDTH) : 1;

  // 고칠 때마다 시안을 다시 조립해 iframe이 새로 열리므로, 열릴 때도 고치던 Pod로 옮긴다.
  // scrollIntoView는 바깥 페이지까지 스크롤하므로 iframe 안의 창만 움직인다
  const scrollToFocus = () => {
    const doc = frameRef.current?.contentDocument;
    const section = focus && doc?.querySelector<HTMLElement>(`section[data-pod="${CSS.escape(focus)}"]`);
    if (section) doc?.defaultView?.scrollTo({ top: section.offsetTop });
  };
  useEffect(scrollToFocus, [focus]);

  const render = async () => {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.render(run.id));
      sectionRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section ref={sectionRef} id="step-render" className={`scroll-mt-28 rounded-xl border bg-white p-6 ${ready ? "" : "opacity-50"}`}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-ink">④ 최종 CRM 시안</h2>
        <div className="flex items-center gap-3">
          {run.html && (
            <button
              onClick={() => setEditing(!editing)}
              disabled={!ready}
              className="rounded-lg border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            >
              {editing ? "수정 닫기" : "시안 수정하기"}
            </button>
          )}
          {run.html && (
            <button onClick={() => setFit(!fit)} className="text-sm text-gray-500 underline hover:text-gray-900">
              {fit ? "실제 크기로 보기" : "화면에 맞춰 보기"}
            </button>
          )}
          {run.html && (
            <a href={api.previewUrl(run)} target="_blank" rel="noreferrer" className="text-sm text-gray-500 underline">
              새 탭에서 열기
            </a>
          )}
          <button
            onClick={render}
            disabled={!ready || busy}
            className="rounded-lg bg-primary hover:bg-primary-hover active:bg-primary-pressed px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "조립 중…" : run.html ? "다시 조립" : "시안 조립"}
          </button>
        </div>
      </div>

      {!ready && <p className="mt-3 text-sm text-gray-500">①~③ 단계(이미지는 모든 Pod)에서 선택하면 조립할 수 있습니다.</p>}
      {error && <ErrorMessage message={error} onClose={() => setError(null)} />}

      {run.html && (
        <div className={editing && ready ? "mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]" : "mt-5"}>
          {/* 시안은 폭 1440px 고정 페이지. 맞춤 보기는 패널 폭에 맞춰 축소하고, 실제 크기는 가로 스크롤로 본다 */}
          <div ref={frameBoxRef} className={`rounded-lg border ${fit ? "overflow-hidden" : "overflow-x-auto"}`}>
            <div style={{ height: FRAME_HEIGHT, width: PAGE_WIDTH * scale }}>
              <iframe
                ref={frameRef}
                title="CRM 시안 미리보기"
                src={api.previewUrl(run)}
                onLoad={scrollToFocus}
                style={{ width: PAGE_WIDTH, height: FRAME_HEIGHT / scale, transform: `scale(${scale})` }}
                className="block origin-top-left"
              />
            </div>
          </div>
          {editing && ready && (
            <div className="overflow-y-auto rounded-lg bg-gray-50 p-3 lg:h-[900px]">
              <PageEditor run={run} focus={focus} onFocus={setFocus} onChange={onChange} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
