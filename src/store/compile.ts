import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  compileProject,
  readCompiledPdf,
  type CompileError,
  type CompileResult,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { notifyError } from "@/lib/toast";
import { compileOfflineForEngine } from "@/lib/document-engine";
import { ensurePandoc } from "@/features/pandoc";

// Bumped on every recompile so a compile that finishes after the project was
// switched (or a newer compile started) can detect it is stale and not overwrite
// the current preview.
let compileSeq = 0;
let rerunQueued = false;
let compileIntentGeneration = 0;
let activeCompileIntent: number | null = null;

export type CompileStatus = "idle" | "compiling" | "success" | "error";

// User-facing phase while status === "compiling" (package download vs build).
export type CompilePhase = "idle" | "saving" | "downloading" | "building";

function phaseFromLogChunk(chunk: string, prev: CompilePhase): CompilePhase {
  // Tectonic talks about downloading/fetching packages on first use of a crate.
  if (/download|fetching|connecting to|resolving/i.test(chunk)) return "downloading";
  if (/running|xetex|lualatex|writing|synctex/i.test(chunk) && prev === "downloading") {
    return "building";
  }
  return prev === "idle" || prev === "saving" ? "building" : prev;
}

interface CompileState {
  status: CompileStatus;
  phase: CompilePhase;
  log: string;
  errors: CompileError[];
  pdfBytes: Uint8Array | null;
  lastCompiledAt: number | null;
  compileTimeMs: number | null;
  autoCompile: boolean;
  setAutoCompile: (v: boolean) => void;
  reset: () => void;
  recompile: () => Promise<CompileResult | undefined>;
}

export const useCompileStore = create<CompileState>((set, get) => ({
  status: "idle",
  phase: "idle",
  log: "",
  errors: [],
  pdfBytes: null,
  lastCompiledAt: null,
  compileTimeMs: null,
  autoCompile: false,
  setAutoCompile: (v) => set({ autoCompile: v }),
  reset: () => {
    compileSeq++;
    rerunQueued = false;
    activeCompileIntent = null;
    compileIntentGeneration++;
    set({
      status: "idle",
      phase: "idle",
      log: "",
      errors: [],
      pdfBytes: null,
      lastCompiledAt: null,
      compileTimeMs: null,
    });
  },
  recompile: async () => {
    // Compiles share one build dir, so never run two at once. A request made
    // mid-compile queues exactly one rerun so a manual Cmd+Enter during the
    // on-open auto-compile still compiles the latest edits instead of being
    // silently dropped.
    if (activeCompileIntent !== null || get().status === "compiling") {
      rerunQueued = true;
      return undefined;
    }
    const intent = ++compileIntentGeneration;
    activeCompileIntent = intent;
    const releaseIntent = () => {
      if (activeCompileIntent === intent) activeCompileIntent = null;
    };
    const abortIntent = () => {
      const ownsIntent = activeCompileIntent === intent;
      releaseIntent();
      if (ownsIntent) rerunQueued = false;
    };

    const files = useFilesStore.getState();
    const capturedProjectId = files.projectId;
    if (!files.engineLoaded) {
      notifyError(
        "compile",
        files.engineError ?? "Document engine details are still loading.",
        "Compile is disabled until the document engine is loaded.",
      );
      abortIntent();
      return undefined;
    }
    if (files.engine.capabilities.compiler_prerequisite === "pandoc") {
      try {
        if (!(await ensurePandoc())) {
          abortIntent();
          return undefined;
        }
      } catch (e) {
        notifyError("Pandoc setup", e);
        abortIntent();
        return undefined;
      }
    }
    if (useFilesStore.getState().projectId !== capturedProjectId) {
      abortIntent();
      return undefined;
    }
    try {
      await files.saveActive();
    } catch (e) {
      notifyError("save before compile", e);
      abortIntent();
      return undefined;
    }
    if (
      activeCompileIntent !== intent ||
      useFilesStore.getState().projectId !== capturedProjectId
    ) {
      abortIntent();
      return undefined;
    }

    const projectId = capturedProjectId ?? "default";
    const mainDoc = files.mainDoc || "main.tex";
    const offlinePolicy = compileOfflineForEngine(
      files.engine,
      useSettingsStore.getState().offline,
    );
    const seq = ++compileSeq;
    // True once this compile's result is no longer the one the UI should show
    // (project switched, or a newer compile started).
    const stale = () => seq !== compileSeq || useFilesStore.getState().projectId !== capturedProjectId;

    set({
      status: "compiling",
      phase: "building",
      log: offlinePolicy.notice ? `${offlinePolicy.notice}\n` : "",
      errors: [],
    });
    let unlisten = () => {};
    try {
      unlisten = await listen<string>("compile:log", (e) => {
        if (seq !== compileSeq) return;
        set((s) => ({ log: s.log + e.payload, phase: phaseFromLogChunk(e.payload, s.phase) }));
      });
      const result = await compileProject(projectId, mainDoc, offlinePolicy.offline);
      // Wrap the IPC ArrayBuffer as a view (no copy of the payload bytes). Read
      // whenever a PDF exists, even on error: Tectonic's continue-on-errors mode
      // still produces a best-effort PDF, and we want to keep showing it.
      const buf = result.has_pdf ? await readCompiledPdf(projectId) : null;
      const bytes = buf ? new Uint8Array(buf) : null;
      if (stale()) return result;
      set((state) => ({
        status: result.ok && bytes ? "success" : "error",
        phase: "idle",
        pdfBytes: bytes ?? state.pdfBytes,
        errors: result.errors,
        log: `${offlinePolicy.notice ? `${offlinePolicy.notice}\n` : ""}${result.log}`,
        lastCompiledAt: result.ok && bytes ? Date.now() : state.lastCompiledAt,
        compileTimeMs: result.ok && bytes ? (result.compile_time_ms ?? 0) : state.compileTimeMs,
      }));
      // Tell detached windows (PDF preview, other OS windows) to reload.
      void import("@/lib/preview-window").then((m) => m.refreshPreviewWindow()).catch(() => {});
      void import("@/lib/cross-window").then((m) => m.notifyCompileDone(capturedProjectId)).catch(() => {});
      // A successful compile is the natural checkpoint: auto-commit the
      // project (compiling already saved the active file first).
      if (result.ok && bytes && capturedProjectId) {
        const pid = capturedProjectId;
        void import("@/lib/auto-commit").then((m) => m.autoCommitNow(pid)).catch(() => {});
      }
      return result;
    } catch (e) {
      if (!stale()) {
        set({
          status: "error",
          phase: "idle",
          log: `${offlinePolicy.notice ? `${offlinePolicy.notice}\n` : ""}Compile failed: ${String(e)}`,
        });
      }
      void import("@/lib/log").then(({ logError }) => logError("compile", e));
      return undefined;
    } finally {
      unlisten();
      const ownsIntent = activeCompileIntent === intent;
      releaseIntent();
      if (ownsIntent && rerunQueued) {
        rerunQueued = false;
        if (!stale()) void get().recompile();
      }
    }
  },
}));
