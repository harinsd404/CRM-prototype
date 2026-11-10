import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @types/node 없이 빌드 시 환경 변수(VITE_BASE)만 읽는다
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  // 배포 경로(예: /park/). 비우면 / (로컬 개발)
  base: process.env.VITE_BASE || "/",
  plugins: [react(), tailwindcss()],
  server: {
    // /api 요청은 FastAPI(8000)로 넘긴다. 같은 출처가 되므로 CORS 설정이 필요 없다.
    proxy: { "/api": "http://localhost:8000" },
  },
});
