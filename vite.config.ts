import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Tauri expects a fixed port; if that's not available it will attempt the next one.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  // pdf.js v6 loads its worker as an ES module; build ours the same way so the
  // polyfill wrapper worker (src/components/pdf/pdf.worker.ts) loads correctly.
  worker: { format: "es" as const },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@openleaf/latex": path.resolve(__dirname, "./packages/latex/src"),
      "@openleaf/ai-core": path.resolve(__dirname, "./packages/ai-core/src"),
    },
  },
  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Don't watch the Rust source; handled by tauri.
      ignored: ["**/src-tauri/**"],
    },
  },
}));
