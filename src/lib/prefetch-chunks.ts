// Warm the code-split chunks once the app is interactive.
//
// Splitting them off the entry chunk is what keeps first paint fast, but it
// moves the cost to the first click: React suspends while the chunk loads, so
// a panel that used to appear instantly now appears a few hundred milliseconds
// later — and under load, slower than that. Fetching them during idle time
// after the shell has mounted gets both properties: a small entry chunk, and a
// module that is already parsed by the time anyone opens it.
//
// The desktop app serves these from local disk, so this costs no network.
// Failures are ignored on purpose: this is a warm-up, and the real import at
// use time will surface any genuine error.

const warm = () => {
  const load = (p: Promise<unknown>) => void p.catch(() => {});

  // Surfaces the user reaches first.
  load(import("@/components/editor/Editor"));
  load(import("@/components/preview/PreviewPane"));

  // Rail panels.
  load(import("@/components/layout/ReferencesPanel"));
  load(import("@/components/layout/SourceControl"));
  load(import("@/components/preflight/PreflightPanel"));
  load(import("@/components/ai/ChatPanel"));

  // Modals and views opened from menus and the library.
  load(import("@/components/layout/SettingsModal"));
  load(import("@/components/library/TemplateGenerateModal"));
  load(import("@/components/editor/WordCountModal"));
  load(import("@/components/editor/HistoryModal"));
  load(import("@/components/editor/HotkeysModal"));
  load(import("@/components/import/PdfImportView"));
};

let started = false;

/** Idempotent; safe to call from a mount effect that may run twice. */
export function prefetchLazyChunks(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const schedule =
    window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
  schedule(() => warm());
}
