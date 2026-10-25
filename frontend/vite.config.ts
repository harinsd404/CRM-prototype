import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // /api 요청은 FastAPI(8000)로 넘긴다. 같은 출처가 되므로 CORS 설정이 필요 없다.
    proxy: { "/api": "http://localhost:8000" },
  },
});
