import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { STEP_ORDER, isStepComplete, type PodName, type RunState } from "../types";
import ErrorMessage from "./ErrorMessage";
import PageEditor from "./PageEditor";

const PAGE_WIDTH = 1440; // 시안 템플릿의 고정 폭
const FRAME_HEIGHT = 900; // 화면에 보이는 미리보기 높이 (수정 중에는 창 높이를 다 쓴다). 시안은 iframe 안에서 세로로 스크롤한다

interface Props {
  run: RunState;
  onChange: (run: RunState) => void;
}

/** ④ 최종 시안: 선택된 결과를 템플릿으로 조립하고 iframe으로 미리 본다.
 *  수정 모드는 창 전체를 덮는 편집 화면으로 열린다: 왼쪽 미리보기(남은 폭·창 높이) + 오른쪽 수정 패널 (PageEditor). */
export default function HtmlPreview({ run, onChange }: Props) {
  const ready = STEP_ORDER.every((step) => isStepComplete(run, step));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState(true); // 패널 폭에 맞춰 축소 / 실제 크기(가로 스크롤)
  const sectionRef = useRef<HTMLElement>(null);
  const frameBoxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: PAGE_WIDTH, height: FRAME_HEIGHT });
  const [editing, setEditing] = useState(false);
  const [focus, setFocus] = useState<PodName | null>(null); // 수정 중인 Pod. 미리보기를 그 섹션으로 옮긴다
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameVersion, setFrameVersion] = useState(0); // iframe이 새로 열릴 때마다 +1 (PageEditor가 이벤트를 다시 붙인다)
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null); // 미리보기 위 이미지 조정 툴바 자리
  const frameScroll = useRef<number | null>(null); // 시안을 다시 열어도 보던 위치를 지킨다
  const [draft, setDraft] = useState<{ html: string | null; dirty: boolean }>({ html: null, dirty: false }); // 확정 전 시안

  useEffect(() => {
    const box = frameBoxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) =>
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [run.html, editing]);
  const scale = fit ? Math.min(1, box.width / PAGE_WIDTH) : 1;
  const frameHeight = editing ? Math.max(200, box.height) : FRAME_HEIGHT;

  // 편집 화면이 창을 덮는 동안 뒤 페이지는 스크롤되지 않게 한다
  useEffect(() => {
    if (!editing) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [editing]);

  const toggleEditing = () => {
    if (editing && draft.dirty && !window.confirm("확정하지 않은 수정을 버리고 기존 디자인을 유지할까요?")) return;
    setEditing(!editing);
    setDraft({ html: null, dirty: false });
  };

  // 미리보기를 그 Pod 섹션으로 옮긴다. scrollIntoView는 바깥 페이지까지 스크롤하므로 iframe 안의 창만 움직인다
  const scrollToPod = (pod: PodName | null) => {
    const doc = frameRef.current?.contentDocument;
    const section = pod && doc?.querySelector<HTMLElement>(`section[data-pod="${CSS.escape(pod)}"]`);
    if (section) doc?.defaultView?.scrollTo({ top: section.offsetTop });
  };

  // 오른쪽 카드를 누르면 미리보기도 그 Pod로 옮긴다. 시안 속 이미지를 눌렀을 때(scroll=false)는 보던 자리를 그대로 둔다
  const focusPod = (pod: PodName, scroll = true) => {
    if (scroll && pod !== focus) scrollToPod(pod);
    setFocus(pod);
  };

  // 고칠 때마다 시안을 다시 조립해 iframe이 새로 열린다. 보던 위치를 되살리고(처음이면 고치던 Pod로), 스크롤을 기억한다
  const onFrameLoad = () => {
    const win = frameRef.current?.contentWindow;
    if (win) {
      if (frameScroll.current != null) win.scrollTo({ top: frameScroll.current });
      else scrollToPod(focus);
      win.addEventListener("scroll", () => (frameScroll.current = win.scrollY));
    }
    setFrameVersion((v) => v + 1);
  };

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

  const viewLinks = run.html && (
    <>
      <button onClick={() => setFit(!fit)} className="text-sm text-gray-500 underline hover:text-gray-900">
        {fit ? "실제 크기로 보기" : "화면에 맞춰 보기"}
      </button>
      <a href={api.previewUrl(run)} target="_blank" rel="noreferrer" className="text-sm text-gray-500 underline">
        새 탭에서 열기
      </a>
    </>
  );

  // 시안은 폭 1440px 고정 페이지. 맞춤 보기는 상자 폭에 맞춰 축소하고, 실제 크기는 가로 스크롤로 본다
  const preview = run.html && (
    <div
      ref={frameBoxRef}
      className={`relative rounded-lg border bg-white ${fit ? "overflow-clip" : "overflow-x-auto"} ${
        editing ? "min-h-0 min-w-0 flex-1" : ""
      }`}
    >
      {/* 이미지 조정 툴바 (PageEditor → FrameCrop이 이 자리에 띄운다). 미리보기 위에 겹쳐 둔다 */}
      <div ref={setToolbarHost} className="pointer-events-none absolute left-2 right-2 top-2 z-[5]" />
      <div style={{ height: frameHeight, width: PAGE_WIDTH * scale }}>
        <iframe
          ref={frameRef}
          title="CRM 시안 미리보기"
          // 확정 전 수정이 있으면 서버가 저장 없이 조립한 시안을 보여 준다
          {...(editing && draft.html ? { srcDoc: draft.html } : { src: api.previewUrl(run) })}
          onLoad={onFrameLoad}
          style={{ width: PAGE_WIDTH, height: frameHeight / scale, transform: `scale(${scale})` }}
          className="block origin-top-left"
        />
      </div>
    </div>
  );

  return (
    <section ref={sectionRef} id="step-render" className={`scroll-mt-28 rounded-xl border bg-white p-6 ${ready ? "" : "opacity-50"}`}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-ink">④ 최종 CRM 시안</h2>
        <div className="flex items-center gap-3">
          {viewLinks}
          {run.html && (
            <button
              onClick={toggleEditing}
              disabled={!ready}
              className="rounded-lg border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            >
              시안 수정하기
            </button>
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

      {run.html && !(editing && ready) && <div className="mt-5">{preview}</div>}

      {/* 편집 화면: 창 전체를 덮는다 (앱 헤더·피드백 버튼 위) */}
      {run.html && editing && ready && (
        <div role="dialog" aria-label="시안 수정" className="fixed inset-0 z-50 flex flex-col bg-gray-100">
          <div className="flex items-center justify-between gap-4 border-b bg-white px-5 py-2.5">
            <h2 className="font-semibold text-ink">④ 시안 수정</h2>
            <div className="flex items-center gap-3">
              {viewLinks}
              <button
                onClick={toggleEditing}
                className="rounded-lg border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
              >
                수정 닫기
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 gap-4 p-4">
            {preview}
            <div className="w-[400px] shrink-0 overflow-y-auto rounded-lg bg-gray-50">
              <div className="p-3">
                <PageEditor
                  run={run}
                  focus={focus}
                  onFocus={focusPod}
                  onChange={onChange}
                  onDraft={(html, dirty) => setDraft((prev) => ({ html: html === undefined ? prev.html : html, dirty }))}
                  frame={frameRef.current}
                  frameVersion={frameVersion}
                  toolbarHost={toolbarHost}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
