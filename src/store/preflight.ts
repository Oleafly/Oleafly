import { create } from "zustand";
import { runPreflight } from "@openleaf/preflight";
import { extractForPreflight } from "@openleaf/preflight/pdf-extract";
import type { RefsContext } from "@openleaf/preflight";
import type { PreflightReport } from "@openleaf/preflight";
import { parseEntry } from "@/lib/citation/bibtex";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { useIndexStore } from "@/store/project-index";

function buildRefsContext(files: ReturnType<typeof useFilesStore.getState>): RefsContext {
  // Labels and bib keys come from the shared project index (the single parser);
  // runRefsRules also re-scans the active source for its own labels, so a just-
  // typed label resolves even before the debounced index catches up.
  const index = useIndexStore.getState().index;
  const definedLabels = index ? index.defs.filter((d) => d.kind === "label").map((d) => d.name) : [];
  const bibKeys = index ? index.defs.filter((d) => d.kind === "bibentry").map((d) => d.name) : [];
  const hasBibFile = Object.keys(files.files).some((p) => p.endsWith(".bib")) || files.tree.some((f) => f.path.endsWith(".bib"));
  const bibLoaded = bibKeys.length > 0 || hasBibFile;

  // Duplicate detection needs DOIs, which the index does not store, so parse the
  // loaded .bib files for those.
  const doiToKeys = new Map<string, string[]>();
  for (const [path, state] of Object.entries(files.files)) {
    if (!path.endsWith(".bib")) continue;
    for (const chunk of state.content.split(/(?=@\w+\s*\{)/)) {
      const p = parseEntry(chunk.trim());
      const doi = p?.fields.doi?.trim().toLowerCase();
      if (p && doi) doiToKeys.set(doi, [...(doiToKeys.get(doi) ?? []), p.key]);
    }
  }
  const duplicateDois = [...doiToKeys.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([doi, keys]) => ({ doi, keys }));

  // Project files (for missing-asset checks) must include images too, so use the
  // full tree rather than the index (which only indexes .tex/.bib).
  const projectFiles = files.tree.filter((f) => !f.is_dir).map((f) => f.path);
  return { bibKeys, definedLabels, bibLoaded, projectFiles, duplicateDois };
}

// Bumped on every run so a preflight pass that finishes after the project was
// switched can detect it is stale and not paint the old report into the new one.
let preflightSeq = 0;

export type CheckId = "ats" | "a11y" | "refs";
export type CheckFlags = Record<CheckId, boolean>;
const NO_FLAGS: CheckFlags = { ats: false, a11y: false, refs: false };

interface PreflightStore {
  report: PreflightReport | null;
  pageText: string[];
  running: boolean;
  showReader: boolean;
  error: string | null;
  ran: CheckFlags;
  // null = use the document-type suggestion.
  enabled: CheckFlags | null;
  // null = use the suggestion.
  open: CheckFlags | null;
  setRan: (f: CheckFlags) => void;
  setEnabled: (f: CheckFlags) => void;
  setOpen: (f: CheckFlags) => void;
  toggleReader: () => void;
  run: () => Promise<void>;
  reset: () => void;
}

export const usePreflightStore = create<PreflightStore>((set) => ({
  report: null,
  pageText: [],
  running: false,
  showReader: false,
  error: null,
  ran: NO_FLAGS,
  enabled: null,
  open: null,

  setRan: (ran) => set({ ran }),
  setEnabled: (enabled) => set({ enabled }),
  setOpen: (open) => set({ open }),
  toggleReader: () => set((s) => ({ showReader: !s.showReader })),
  reset: () =>
    set({ report: null, pageText: [], running: false, showReader: false, error: null, ran: NO_FLAGS, enabled: null, open: null }),

  run: async () => {
    const seq = ++preflightSeq;
    const pid = useFilesStore.getState().projectId;
    const stale = () => seq !== preflightSeq || useFilesStore.getState().projectId !== pid;
    set({ running: true, error: null });
    try {
      const files = useFilesStore.getState();
      // Lint the document currently in the editor so source offsets line up with
      // the editor for jump-to-source; fall back to the main document.
      const path = files.activePath ?? files.mainDoc;
      const source = files.files[path]?.content ?? files.files[files.mainDoc]?.content ?? "";

      const refs = buildRefsContext(files);

      const bytes = useCompileStore.getState().pdfBytes;
      if (bytes) {
        const ex = await extractForPreflight(bytes);
        if (stale()) return; // project switched during PDF extraction
        const report = runPreflight({
          source,
          pages: ex.pages,
          meta: { lang: ex.lang, title: ex.title, tagged: ex.tagged },
          readerText: ex.pageText.join("\n"),
          struct: ex.struct,
          refs,
        });
        set({ report, pageText: ex.pageText, running: false });
      } else {
        const report = runPreflight({ source, refs });
        if (stale()) return;
        set({ report, pageText: [], running: false });
      }
    } catch (e) {
      if (!stale()) set({ running: false, error: String(e) });
      void import("@/lib/log").then(({ logError }) => logError("preflight", e));
    }
  },
}));
