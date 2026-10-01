import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 開發時：前端跑在 5173，/api 轉給本機 FastAPI（8000）。
// 正式部署：由 nginx 同網域提供前端靜態檔並轉發 /api，見 web/nginx.conf。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  // recharts 本身就大，單一檔 ~700KB（gzip 約 210KB），內網測試可接受
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 1000 },
});
