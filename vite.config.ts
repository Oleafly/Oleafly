import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Tauri expects a fixed port; if that's not available it will attempt the next one.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    exclude: ["harper.js"],
  },
  // pdf.js v6 loads its worker as an ES module; build ours the same way so the
  // polyfill wrapper worker (src/components/pdf/pdf.worker.ts) loads correctly.
  worker: { format: "es" as const },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@openleaf/latex": path.resolve(__dirname, "./packages/latex/src"),
      "@openleaf/ai-core": path.resolve(__dirname, "./packages/ai-core/src"),
      "@openleaf/diagram": path.resolve(__dirname, "./packages/diagram/src"),
      "@openleaf/editor": path.resolve(__dirname, "./packages/editor/src"),
      "@openleaf/ai-tools": path.resolve(__dirname, "./packages/ai-tools/src"),
      "@openleaf/preflight": path.resolve(__dirname, "./packages/preflight/src"),
      "@openleaf/registry": path.resolve(__dirname, "./packages/registry/src"),
      "@openleaf/templates": path.resolve(__dirname, "./packages/templates/src"),
      "@openleaf/preview": path.resolve(__dirname, "./packages/preview/src"),
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
