import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { STEP_ORDER, isStepComplete, type RunState } from "../types";
import ErrorMessage from "./ErrorMessage";

const PAGE_WIDTH = 1440; // 시안 템플릿의 고정 폭
const FRAME_HEIGHT = 900; // 화면에 보이는 미리보기 높이. 시안은 iframe 안에서 세로로 스크롤한다

interface Props {
  run: RunState;
  onChange: (run: RunState) => void;
}

/** ④ 최종 시안: 선택된 결과를 템플릿으로 조립하고 iframe으로 미리 본다. */
export default function HtmlPreview({ run, onChange }: Props) {
  const ready = STEP_ORDER.every((step) => isStepComplete(run, step));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState(true); // 패널 폭에 맞춰 축소 / 실제 크기(가로 스크롤)
  const sectionRef = useRef<HTMLElement>(null);
  const frameBoxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(PAGE_WIDTH);

  useEffect(() => {
    const box = frameBoxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
    observer.observe(box);
    return () => observer.disconnect();
  }, [run.html]);
  const scale = fit ? Math.min(1, boxWidth / PAGE_WIDTH) : 1;

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
    <section ref={sectionRef} id="step-render" className={`scroll-mt-24 rounded-xl border bg-white p-6 ${ready ? "" : "opacity-50"}`}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-ink">④ 최종 CRM 시안</h2>
        <div className="flex items-center gap-3">
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

      {!ready && <p className="mt-3 text-sm text-gray-500">①~③ 단계(이미지는 Pod 5개 모두)에서 선택하면 조립할 수 있습니다.</p>}
      {error && <ErrorMessage message={error} onClose={() => setError(null)} />}

      {run.html && (
        // 시안은 폭 1440px 고정 페이지. 맞춤 보기는 패널 폭에 맞춰 축소하고, 실제 크기는 가로 스크롤로 본다
        <div ref={frameBoxRef} className={`mt-5 rounded-lg border ${fit ? "overflow-hidden" : "overflow-x-auto"}`}>
          <div style={{ height: FRAME_HEIGHT, width: PAGE_WIDTH * scale }}>
            <iframe
              title="CRM 시안 미리보기"
              src={api.previewUrl(run)}
              style={{ width: PAGE_WIDTH, height: FRAME_HEIGHT / scale, transform: `scale(${scale})` }}
              className="block origin-top-left"
            />
          </div>
        </div>
      )}
    </section>
  );
}
