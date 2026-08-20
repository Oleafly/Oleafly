// The e2e suite drives the app through evaluated snippets that import app
// modules by their Vite dev-server URL ("/src/lib/tauri.ts"). A packaged
// build has no dev server, so the packaged e2e boot (the init script in
// src-tauri/src/lib.rs sets window.__OLEAFLY_E2E_BOOT__) registers this
// resolver and the test fixtures rewrite those imports to go through it.
// Every entry is a lazy chunk the bundle already contains; registering the
// resolver adds no eager code to the app.
const registry: Record<string, () => Promise<unknown>> = {
  "/src/components/editor/cm/controller.ts": () => import("@/components/editor/cm/controller"),
  "/src/components/editor/SymbolPicker.tsx": () => import("@/components/editor/SymbolPicker"),
  "/src/components/editor/wysiwyg/controller.ts": () =>
    import("@/components/editor/wysiwyg/controller"),
  "/src/features/citation.ts": () => import("@/features/citation"),
  "/src/features/synctex.ts": () => import("@/features/synctex"),
  "/src/lib/ai-model-state.ts": () => import("@/lib/ai-model-state"),
  "/src/lib/ai-providers.ts": () => import("@/lib/ai-providers"),
  "/src/lib/aux-numbers.ts": () => import("@/lib/aux-numbers"),
  "/src/lib/compile-checkpoint.ts": () => import("@/lib/compile-checkpoint"),
  "/src/lib/dictionary.ts": () => import("@/lib/dictionary"),
  "/src/lib/e2e-probe.ts": () => import("@/lib/e2e-probe"),
  "/src/lib/mcp-bridge.ts": () => import("@/lib/mcp-bridge"),
  "/src/lib/proofreading/client.ts": () => import("@/lib/proofreading/client"),
  "/src/lib/proofreading/hunspell.ts": () => import("@/lib/proofreading/hunspell"),
  "/src/lib/tauri.ts": () => import("@/lib/tauri"),
  "/src/lib/wordcount.ts": () => import("@/lib/wordcount"),
  "/src/store/citation.ts": () => import("@/store/citation"),
  "/src/store/compile.ts": () => import("@/store/compile"),
  "/src/store/files.ts": () => import("@/store/files"),
  "/src/store/inlineEdit.ts": () => import("@/store/inlineEdit"),
  "/src/store/preflight.ts": () => import("@/store/preflight"),
  "/src/store/project-analysis.ts": () => import("@/store/project-analysis"),
  "/src/store/project-index.ts": () => import("@/store/project-index"),
  "/src/store/proofreading.ts": () => import("@/store/proofreading"),
  "/src/store/settings.ts": () => import("@/store/settings"),
  "/packages/editor/src/controller.ts": () => import("../../packages/editor/src/controller"),
  "/packages/editor/src/index.ts": () => import("@oleafly/editor"),
  "/packages/preflight/src/doc-type.ts": () => import("../../packages/preflight/src/doc-type"),
  "/packages/wysiwyg/src/latex/serialize.ts": () => import("../../packages/wysiwyg/src/latex/serialize"),
};

export function registerE2EImports() {
  (
    window as unknown as { __oleaflyE2EImport?: (path: string) => Promise<unknown> }
  ).__oleaflyE2EImport = (path: string) => {
    const load = registry[path];
    if (!load) {
      return Promise.reject(
        new Error(`e2e import registry has no entry for ${path}; add it to e2e-import-registry.ts`),
      );
    }
    return load();
  };
}
