import { useEffect, useRef } from "react";
import { api } from "./api";
import type { RunState } from "./types";

/** 생성이 도는 동안 실행을 주기적으로 다시 읽는다. 이미지는 한 장씩 끝나는 대로 저장되므로 바로 화면에 나온다.
 *  늦게 도착한 읽기 결과가 더 최신 실행을 덮지 않도록 updated_at이 더 새로울 때만 반영한다. */
export function useRunPolling(active: boolean, run: RunState, onChange: (run: RunState) => void) {
  const latest = useRef(run);
  latest.current = run;
  const notify = useRef(onChange);
  notify.current = onChange;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      const polled = await api.getRun(latest.current.id).catch(() => null);
      if (!stopped && polled && polled.updated_at > latest.current.updated_at) notify.current(polled);
    }, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [active]);
}

const POLL_INTERVAL_MS = 2000;

/** 생성 중에 탭을 닫거나 새로고침하면 브라우저가 한 번 묻는다. 이미지 Pod별 생성은 화면이 차례로 요청하므로 끊기면 멈춘다. */
export function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}
