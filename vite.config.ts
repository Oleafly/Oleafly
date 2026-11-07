import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { VITE_CLIENT_WITHOUT_TRANSPORT } from "./e2e/vite-client-without-transport";
import {
  PDFJS_CMAPS_PATH,
  PDFJS_ICCS_PATH,
  PDFJS_STANDARD_FONTS_PATH,
  PDFJS_WASM_PATH,
} from "./packages/preview/src/pdfDocumentOptions";
import {
  assertNoProductionDevHookTokens,
  assertNoTauriStyleNonceTriggers,
} from "./scripts/production-hook-audit.mjs";
import { tailwindPropertiesFallbackPlugin } from "./src/build/tailwind-properties-fallback";

// Tauri expects a fixed port; if that's not available it will attempt the next one.
const host = process.env.TAURI_DEV_HOST;

const staticE2eClient = (): Plugin => ({
  name: "static-e2e-vite-client",
  apply: "serve",
  configureServer(server) {
    if (process.env.OLEAFLY_E2E_DISABLE_HMR !== "1") return;
    // Vite 6 still connects its client socket with server.hmr=false. Serve
    // the static client to module workers too, beyond Playwright page routes.
    server.middlewares.use((request, response, next) => {
      if (request.url?.split("?")[0] !== "/@vite/client") return next();
      response.setHeader("Content-Type", "application/javascript");
      response.end(VITE_CLIENT_WITHOUT_TRANSPORT);
    });
  },
});

// Keep only comments that carry distribution/licensing instructions. Terser
// receives the comment body without `/*`/`//`, so a leading `!` covers `/*!`.
export const LEGAL_COMMENT_PATTERN =
  /^!|@preserve|@license|@cc_on/i;

const LAZY_LOCALE_NAMESPACES = new Set(["cloud", "collab", "settingsFile"]);

export function localeChunk(id: string): string | undefined {
  const match = /\/src\/i18n\/locales\/([^/]+)\/([^/?]*?)(?:\.json)?(?:\?|$)/.exec(id);
  if (!match || match[1] === "en") return undefined;
  return LAZY_LOCALE_NAMESPACES.has(match[2]) ? `locale-${match[1]}-${match[2]}` : `locale-${match[1]}`;
}

// The runtime polyfills must run before any library code. An entry chunk runs
// the chunks it imports before its own body, so polyfills inlined in the entry
// ran after the pdf.js chunk, which reads the global `Iterator` (Safari 18.4+)
// as it loads; on older WebKit the app then stopped at the splash. In a chunk
// of their own the polyfills are the entry's first import and run first.
export const POLYFILLS_CHUNK = "polyfills";

export function polyfillsChunk(id: string): string | undefined {
  return /\/packages\/preview\/src\/polyfills\.ts$/.test(id) ? POLYFILLS_CHUNK : undefined;
}

type OutputSummary = {
  type: string;
  fileName: string;
  name?: string;
  isEntry?: boolean;
  imports?: readonly string[];
};

export function entriesLoadingBeforePolyfills(outputs: readonly OutputSummary[]): string[] {
  const chunks = outputs.filter((output) => output.type === "chunk");
  const polyfills = chunks.find((chunk) => chunk.name === POLYFILLS_CHUNK);
  return chunks
    .filter((chunk) => chunk.isEntry && (!polyfills || chunk.imports?.[0] !== polyfills.fileName))
    .map((chunk) => chunk.fileName);
}

const requirePolyfillsFirst = (): Plugin => ({
  name: "require-polyfills-first",
  apply: "build",
  generateBundle(_options, bundle) {
    const late = entriesLoadingBeforePolyfills(Object.values(bundle));
    if (late.length > 0) {
      this.error(
        `${late.join(", ")} must import the ${POLYFILLS_CHUNK} chunk before any other chunk, or library code runs before the polyfills on older WebViews`,
      );
    }
  },
});

const preserveWorkerExports = (): Plugin => ({
  name: "preserve-worker-exports",
  options: (options) => ({ ...options, preserveEntrySignatures: "strict" }),
});

export const PDFJS_DIST_DIR = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));

const PDFJS_ASSET_FOLDERS = [
  { appPath: PDFJS_STANDARD_FONTS_PATH, folder: "standard_fonts" },
  { appPath: PDFJS_WASM_PATH, folder: "wasm" },
  { appPath: PDFJS_CMAPS_PATH, folder: "cmaps" },
  { appPath: PDFJS_ICCS_PATH, folder: "iccs" },
] as const;

const PDFJS_SCRIPTING_ONLY = /^quickjs-eval\./;

const PDFJS_ASSET_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".wasm": "application/wasm",
};

export function pdfjsAssetFiles(distDir = PDFJS_DIST_DIR): Map<string, string> {
  const files = new Map<string, string>();
  for (const { appPath, folder } of PDFJS_ASSET_FOLDERS) {
    const dir = path.join(distDir, folder);
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !PDFJS_SCRIPTING_ONLY.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const name of names) files.set(`${appPath}${name}`, path.join(dir, name));
  }
  return files;
}

export const pdfjsAssets = (distDir = PDFJS_DIST_DIR): Plugin => ({
  name: "pdfjs-assets",
  configureServer(server) {
    const base = server.config.base;
    const files = pdfjsAssetFiles(distDir);
    server.middlewares.use((request, response, next) => {
      const url = request.url?.split("?")[0] ?? "";
      const source = url.startsWith(base) ? files.get(url.slice(base.length)) : undefined;
      if (!source) return next();
      response.setHeader("Content-Type", PDFJS_ASSET_TYPES[path.extname(source)] ?? "application/octet-stream");
      response.end(readFileSync(source));
    });
  },
  generateBundle() {
    for (const [fileName, source] of pdfjsAssetFiles(distDir)) {
      this.emitFile({ type: "asset", fileName, source: readFileSync(source) });
    }
  },
});

export const rejectProductionDevHooks = (): Plugin => ({
  name: "reject-production-dev-hooks",
  // E2E-only HTML fixtures intentionally use inline styles in the dev server.
  // Tauri's nonce rewrite applies to bundled assets, so audit build output only.
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler(html) {
      // Vite emits index.html after user generateBundle hooks. Audit the final
      // transformed markup here so an inline style cannot silently re-enable
      // Tauri's style-src nonce and disable CodeMirror's runtime stylesheet.
      assertNoTauriStyleNonceTriggers([["index.html", html]]);
      return html;
    },
  },
  generateBundle(_options, bundle) {
    if (process.env.VITE_E2E_HOOKS === "1") {
      this.warn(
        "VITE_E2E_HOOKS=1: this bundle contains test hooks and must never ship to users",
      );
      return;
    }
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
  plugins: [
    react(),
    tailwindcss(),
    tailwindPropertiesFallbackPlugin(),
    rejectProductionDevHooks(),
    requirePolyfillsFirst(),
    staticE2eClient(),
    pdfjsAssets(),
  ],
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
      // Proofreading starts when the first prose project opens. Pre-bundle the
      // Hunspell Emscripten wrapper at dev-server startup so that first use
      // cannot invalidate Vite's dependency graph and blank/reload the Tauri
      // WebView in the middle of project startup.
      "hunspell-asm",
      // Citation formatting is lazy, but it is also the first action in every
      // reference tool. Pre-bundle the shared parser and CSL engine so opening
      // a tool cannot trigger Vite's dependency-discovery reload mid-session.
      "@citation-js/core",
      "@citation-js/plugin-bibtex",
      "@citation-js/plugin-csl",
    ],
  },
  // pdf.js v6 loads its worker as an ES module; build ours the same way so the
  // polyfill wrapper worker (src/components/pdf/pdf.worker.ts) loads correctly.
  worker: {
    format: "es" as const,
    plugins: () => [preserveWorkerExports()],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          // The pdf.js main library is shared by several lazy consumers
          // (preview, import, preflight, AI tools). Without a name, rollup's
          // shared chunk adopts the pdf.worker?worker&url facade's name,
          // which trips the performance budget's strict one-worker gate.
          if (/node_modules\/pdfjs-dist\/build\/pdf\.mjs/.test(id)) {
            return "pdfjs-lib";
          }
          // The ?worker&url facade is a one-line URL export. Left unnamed it
          // becomes a chunk called pdf.worker-<hash>.js, which the budget's
          // one-real-worker gate would count as a second worker.
          if (/pdf\.worker\.ts\?worker/.test(id)) {
            return "pdf-worker-url";
          }
          return polyfillsChunk(id) ?? localeChunk(id);
        },
      },
    },
    minify: "terser" as const,
    terserOptions: {
      ecma: 2020 as const,
      compress: {
        passes: 4,
      },
      format: {
        comments: LEGAL_COMMENT_PATTERN,
      },
    },
  },
  resolve: {
    alias: {
      "node-fetch": path.resolve(__dirname, "./src/shims/citation-browser-fetch.ts"),
      "sync-fetch": path.resolve(__dirname, "./src/shims/citation-browser-sync-fetch.ts"),
      "@": path.resolve(__dirname, "./src"),
      "@oleafly/latex": path.resolve(__dirname, "./packages/latex/src"),
      "@oleafly/wysiwyg": path.resolve(__dirname, "./packages/wysiwyg/src"),
      "@oleafly/ai-core": path.resolve(__dirname, "./packages/ai-core/src"),
      "@oleafly/backend-port": path.resolve(__dirname, "./packages/backend-port/src"),
      "@oleafly/compile-port/testing": path.resolve(__dirname, "./packages/compile-port/src/testing.ts"),
      "@oleafly/compile-port": path.resolve(__dirname, "./packages/compile-port/src"),
      "@oleafly/diagram": path.resolve(__dirname, "./packages/diagram/src"),
      "@oleafly/editor": path.resolve(__dirname, "./packages/editor/src"),
      "@oleafly/ai-tools": path.resolve(__dirname, "./packages/ai-tools/src"),
      "@oleafly/preflight": path.resolve(__dirname, "./packages/preflight/src"),
      "@oleafly/registry": path.resolve(__dirname, "./packages/registry/src"),
      "@oleafly/i18n-contract": path.resolve(__dirname, "./packages/i18n-contract/src"),
      "@oleafly/search-query": path.resolve(__dirname, "./packages/search-query/src"),
      "@oleafly/templates": path.resolve(__dirname, "./packages/templates/src"),
      "@oleafly/preview": path.resolve(__dirname, "./packages/preview/src"),
      "@oleafly/pdf-to-latex": path.resolve(__dirname, "./packages/pdf-to-latex/src"),
      "@oleafly/latex-intelligence": path.resolve(__dirname, "./packages/latex-intelligence/src"),
      "@oleafly/conversion-registry": path.resolve(__dirname, "./packages/conversion-registry/src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // Browser evidence also loads module workers, whose HMR sockets cannot be
    // intercepted by page routes and can trip Playwright's Firefox adapter.
    hmr: process.env.OLEAFLY_E2E_DISABLE_HMR === "1"
      ? false
      : host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Don't watch the Rust source; handled by tauri.
      ignored: ["**/src-tauri/**", "**/crates/**", "**/*.test.ts", "**/*.test.tsx"],
    },
  },
}));
