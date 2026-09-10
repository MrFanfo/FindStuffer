import { defineConfig } from "vite";
// @ts-expect-error Build-only JavaScript plugin
import { offlineShell } from "./sw-build.mjs";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), offlineShell()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
  build: {
    target: "es2020",
    sourcemap: false,
    manifest: true,
  },
});
