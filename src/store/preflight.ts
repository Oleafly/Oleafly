import { create } from "zustand";
import { CHECK_IDS, detectSubmissionProfile, runPreflight } from "@oleafly/preflight";
import type { CheckId, PreflightEngine, PreflightReport, SubmissionProfileId } from "@oleafly/preflight";
import type { DocumentEngineDescriptor, TexFlavor } from "@/lib/tauri";
import { buildProjectContext, buildRefsContext, type PreflightContextInput } from "@/lib/preflight-context";
import { i18n } from "@/i18n";
import { logError } from "@/lib/log";
import { engineErrorMessage, useFilesStore } from "@/store/files";
import { isCompileCheckpointCurrent, useCompileStore } from "@/store/compile";
import { useIndexStore } from "@/store/project-index";

export function preflightEngineFor(
  engine: DocumentEngineDescriptor["id"],
  flavor: TexFlavor | null | undefined,
): PreflightEngine {
  if (engine === "latex") return "bundled";
  if (engine === "latexmk") return flavor === "uplatex" || flavor === "platex" ? "unknown" : (flavor ?? "unknown");
  if (engine === "typst") return "typst";
  return "unknown";
}

function contextInput(files: ReturnType<typeof useFilesStore.getState>): PreflightContextInput {
  const indexState = useIndexStore.getState();
  return {
    mainDoc: files.mainDoc,
    treePaths: files.tree.filter((f) => !f.is_dir).map((f) => f.path),
    indexTexts: indexState.texts,
    openTexts: Object.fromEntries(Object.entries(files.files).map(([path, state]) => [path, state.content])),
    index: indexState.index,
  };
}

function engineNotLoadedMessage(files: ReturnType<typeof useFilesStore.getState>): string {
  if (files.engineError) return engineErrorMessage(files.engineError);
  return i18n.t(($) => $.core.engine.error.stillLoading);
}

function compileInputFor(compileState: ReturnType<typeof useCompileStore.getState>): {
  outputIsCurrent: boolean;
  compile: { readonly status: "success" | "idle" | "error" | "unavailable"; readonly log: string };
} {
  const outputIsCurrent = isCompileCheckpointCurrent(compileState.lastCompileCheckpoint);
  const settledStatus =
    compileState.status === "success" && outputIsCurrent ? "success" : "idle";
  const compileStatus =
    compileState.status === "error" || compileState.status === "unavailable"
      ? compileState.status
      : settledStatus;
  return {
    outputIsCurrent,
    compile: { status: compileStatus, log: compileStatus === "idle" ? "" : compileState.log } as const,
  };
}

let preflightSeq = 0;

export type CheckFlags = Record<CheckId, boolean>;
const NO_FLAGS = Object.fromEntries(CHECK_IDS.map((id) => [id, false])) as CheckFlags;

interface PreflightStore {
  report: PreflightReport | null;
  pageText: string[];
  running: boolean;
  showReader: boolean;
  error: string | null;
  ran: CheckFlags;
  enabled: CheckFlags | null;
  open: CheckFlags | null;
  submissionProfile: SubmissionProfileId | null;
  anonymousReview: boolean;
  setRan: (f: CheckFlags) => void;
  setEnabled: (f: CheckFlags) => void;
  setOpen: (f: CheckFlags) => void;
  setSubmissionProfile: (profile: SubmissionProfileId) => void;
  setAnonymousReview: (value: boolean) => void;
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
  submissionProfile: null,
  anonymousReview: false,

  setRan: (ran) => set({ ran }),
  setEnabled: (enabled) => set({ enabled }),
  setOpen: (open) => set({ open }),
  setSubmissionProfile: (submissionProfile) => set({ submissionProfile }),
  setAnonymousReview: (anonymousReview) => set({ anonymousReview }),
  toggleReader: () => set((s) => ({ showReader: !s.showReader })),
  reset: () =>
    set({ report: null, pageText: [], running: false, showReader: false, error: null, ran: NO_FLAGS, enabled: null, open: null, submissionProfile: null, anonymousReview: false }),

  run: async () => {
    const seq = ++preflightSeq;
    const pid = useFilesStore.getState().projectId;
    const stale = () => seq !== preflightSeq || useFilesStore.getState().projectId !== pid;
    set({ running: true, error: null });
    try {
      const files = useFilesStore.getState();
      if (!files.engineLoaded) {
        set({ running: false, error: engineNotLoadedMessage(files) });
        return;
      }
      const path = files.activePath ?? files.mainDoc;
      const source = files.files[path]?.content ?? files.files[files.mainDoc]?.content ?? "";

      const input = contextInput(files);
      const refs = buildRefsContext(input);
      const project = buildProjectContext(input);
      const state = usePreflightStore.getState();
      const profileSource = files.files[files.mainDoc]?.content ?? project.files.find((file) => file.path === files.mainDoc)?.content ?? source;
      const submissionProfile = state.submissionProfile ?? detectSubmissionProfile(profileSource);
      const compileState = useCompileStore.getState();
      const { outputIsCurrent, compile } = compileInputFor(compileState);

      const engine = preflightEngineFor(files.engine.id, files.engine.tex_flavor);
      const bytes = outputIsCurrent ? compileState.pdfBytes : null;
      const sourceProfile = files.engine.capabilities.source_preflight_profile;
      const typst =
        sourceProfile === "typst"
          ? await import("@/store/preflight-typst").then(({ typstPreflightInputs }) =>
              typstPreflightInputs(pid, project, files.engine),
            )
          : null;
      if (stale()) return;
      const common = {
        source,
        sourceProfile,
        refs,
        project: typst?.project ?? project,
        ...(typst ? { sourceRules: typst.sourceRules, typstVersion: typst.typstVersion } : {}),
        compile,
        submissionProfile,
        anonymousReview: state.anonymousReview,
        engine,
      };
      const produce = async (): Promise<{ report: PreflightReport; pageText: string[] } | null> => {
        if (!bytes) {
          const report = runPreflight(common);
          if (stale()) return null;
          return { report, pageText: [] };
        }
        const { extractForPreflight } = await import("@oleafly/preflight/pdf-extract");
        const ex = await extractForPreflight(bytes);
        if (stale()) return null;
        const report = runPreflight({
          ...common,
          pages: ex.pages,
          meta: { lang: ex.lang, title: ex.title, tagged: ex.tagged },
          extraction: ex.extraction,
          readerText: ex.pageText.join("\n"),
          struct: ex.struct,
          facts: ex.facts,
        });
        return { report, pageText: ex.pageText };
      };
      const produced = await produce();
      if (produced) set({ report: produced.report, pageText: produced.pageText, running: false });
    } catch (e) {
      if (!stale()) set({ running: false, error: String(e) });
      void logError("preflight", e);
    }
  },
}));
