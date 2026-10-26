import { useEffect, useState } from "react";

/** 작업이 도는 동안 지난 초를 센다. 오래 걸리는 생성이 멈춘 게 아니라는 걸 보여주기 위함. */
export function useElapsed(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    setSeconds(0);
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return running ? seconds : 0;
}

export function formatElapsed(seconds: number): string {
  return seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

/** 생성 중에 탭을 닫거나 새로고침하면 브라우저가 한 번 묻는다. 이미지 Pod별 생성은 화면이 차례로 요청하므로 끊기면 멈춘다. */
export function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}
