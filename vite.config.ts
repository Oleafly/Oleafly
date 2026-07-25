import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { assertNoProductionDevHookTokens } from "./scripts/production-hook-audit.mjs";

// Tauri expects a fixed port; if that's not available it will attempt the next one.
const host = process.env.TAURI_DEV_HOST;

const preserveWorkerExports = (): Plugin => ({
  name: "preserve-worker-exports",
  options: (options) => ({ ...options, preserveEntrySignatures: "strict" }),
});

const rejectProductionDevHooks = (): Plugin => ({
  name: "reject-production-dev-hooks",
  generateBundle(_options, bundle) {
    const artifacts: [string, string][] = [];
    for (const [fileName, output] of Object.entries(bundle)) {
      if (output.type === "chunk") {
        artifacts.push([fileName, output.code]);
      } else if (typeof output.source === "string") {
        artifacts.push([fileName, output.source]);
      }
    }
    try {
      assertNoProductionDevHookTokens(artifacts);
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  },
});

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), rejectProductionDevHooks()],
  optimizeDeps: {
    exclude: ["harper.js"],
    include: [
      "pdfjs-dist/build/pdf.worker.min.mjs",
      // PdfViewer lazy-loads the official link/structure helpers. Pre-bundle
      // them so first use in Tauri dev/E2E does not invalidate Vite's optimized
      // dependency graph and reload the WebView mid-render.
      "pdfjs-dist/web/pdf_viewer.mjs",
      // The production PdfViewer browser-evidence harness builds a deterministic
      // real PDF in-browser. Pre-bundle its fixture generator so the first E2E
      // navigation cannot trigger a dependency-optimizer reload mid-selection.
      "pdf-lib",
    ],
  },
  // pdf.js v6 loads its worker as an ES module; build ours the same way so the
  // polyfill wrapper worker (src/components/pdf/pdf.worker.ts) loads correctly.
  worker: {
    format: "es" as const,
    plugins: () => [preserveWorkerExports()],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@oleafly/latex": path.resolve(__dirname, "./packages/latex/src"),
      "@oleafly/wysiwyg": path.resolve(__dirname, "./packages/wysiwyg/src"),
      "@oleafly/ai-core": path.resolve(__dirname, "./packages/ai-core/src"),
      "@oleafly/diagram": path.resolve(__dirname, "./packages/diagram/src"),
      "@oleafly/editor": path.resolve(__dirname, "./packages/editor/src"),
      "@oleafly/ai-tools": path.resolve(__dirname, "./packages/ai-tools/src"),
      "@oleafly/preflight": path.resolve(__dirname, "./packages/preflight/src"),
      "@oleafly/registry": path.resolve(__dirname, "./packages/registry/src"),
      "@oleafly/templates": path.resolve(__dirname, "./packages/templates/src"),
      "@oleafly/preview": path.resolve(__dirname, "./packages/preview/src"),
      "@oleafly/pdf-to-latex": path.resolve(__dirname, "./packages/pdf-to-latex/src"),
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
