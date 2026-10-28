import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tailwindPropertiesFallbackPlugin } from "./src/build/tailwind-properties-fallback";
import { entriesLoadingBeforePolyfills, LEGAL_COMMENT_PATTERN, POLYFILLS_CHUNK, polyfillsChunk } from "./vite.config";

const repo = __dirname;

export const WEB_ALIASES: Record<string, string> = {
  "@": path.resolve(repo, "./src"),
  "@oleafly/latex": path.resolve(repo, "./packages/latex/src"),
  "@oleafly/backend-port": path.resolve(repo, "./packages/backend-port/src"),
  "@oleafly/compile-port/testing": path.resolve(repo, "./packages/compile-port/src/testing.ts"),
  "@oleafly/compile-port": path.resolve(repo, "./packages/compile-port/src"),
  "@oleafly/editor": path.resolve(repo, "./packages/editor/src"),
  "@oleafly/i18n-contract": path.resolve(repo, "./packages/i18n-contract/src"),
  "@oleafly/preview": path.resolve(repo, "./packages/preview/src"),
  "@oleafly/templates": path.resolve(repo, "./packages/templates/src"),
};

export const WEB_DEV_SERVER = process.env.OLEAFLY_WEB_DEV_SERVER ?? "http://127.0.0.1:4874";

const requirePolyfillsFirst = (): Plugin => ({
  name: "web-require-polyfills-first",
  apply: "build",
  generateBundle(_options, bundle) {
    const late = entriesLoadingBeforePolyfills(Object.values(bundle));
    if (late.length > 0) {
      this.error(`${late.join(", ")} must import the ${POLYFILLS_CHUNK} chunk before any other chunk`);
    }
  },
});

const preserveWorkerExports = (): Plugin => ({
  name: "web-preserve-worker-exports",
  options: (options) => ({ ...options, preserveEntrySignatures: "strict" }),
});

export default defineConfig({
  root: path.resolve(repo, "web"),
  base: "/web/",
  publicDir: false,
  plugins: [react(), tailwindcss(), tailwindPropertiesFallbackPlugin(), requirePolyfillsFirst()],
  resolve: { alias: WEB_ALIASES },
  worker: {
    format: "es",
    plugins: () => [preserveWorkerExports()],
  },
  optimizeDeps: {
    include: ["pdfjs-dist/build/pdf.worker.min.mjs", "pdfjs-dist/web/pdf_viewer.mjs"],
  },
  build: {
    outDir: path.resolve(repo, "web/dist"),
    emptyOutDir: true,
    assetsDir: "assets",
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (/node_modules\/pdfjs-dist\/build\/pdf\.mjs/.test(id)) return "pdfjs-lib";
          if (/pdf\.worker\.ts\?worker/.test(id)) return "pdf-worker-url";
          return polyfillsChunk(id);
        },
      },
    },
    minify: "terser",
    terserOptions: {
      ecma: 2020,
      compress: { passes: 2 },
      format: { comments: LEGAL_COMMENT_PATTERN },
    },
  },
  server: {
    port: 1430,
    strictPort: true,
    proxy: {
      "/web/api": { target: WEB_DEV_SERVER, changeOrigin: false },
      "/web/ws": { target: WEB_DEV_SERVER, ws: true, changeOrigin: false },
      "/web/sign-in": { target: WEB_DEV_SERVER, changeOrigin: false },
      "/web/dev": { target: WEB_DEV_SERVER, changeOrigin: false },
      "/auth": { target: WEB_DEV_SERVER, changeOrigin: false },
    },
  },
});
