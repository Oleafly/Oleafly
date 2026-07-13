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

// Bumped on every recompile so a compile that finishes after the project was
// switched (or a newer compile started) can detect it is stale and not overwrite
// the current preview.
let compileSeq = 0;
let rerunQueued = false;

export type CompileStatus = "idle" | "compiling" | "success" | "error";

/** User-facing phase while status === "compiling" (package download vs build). */
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
  /** Finer-grained status for the UI while compiling. */
  phase: CompilePhase;
  log: string;
  errors: CompileError[];
  pdfBytes: Uint8Array | null;
  lastCompiledAt: number | null;
  compileTimeMs: number | null;
  autoCompile: boolean;
  setAutoCompile: (v: boolean) => void;
  /** Clear all compile state (used when switching projects). */
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
    rerunQueued = false;
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
    if (get().status === "compiling") {
      rerunQueued = true;
      return undefined;
    }

    const files = useFilesStore.getState();
    try {
      await files.saveActive();
    } catch (e) {
      notifyError("save before compile", e);
      return undefined;
    }

    const projectId = files.projectId ?? "default";
    const mainDoc = files.mainDoc || "main.tex";
    const offline = useSettingsStore.getState().offline;
    const seq = ++compileSeq;
    // True once this compile's result is no longer the one the UI should show
    // (project switched, or a newer compile started).
    const stale = () => seq !== compileSeq || useFilesStore.getState().projectId !== files.projectId;

    set({ status: "compiling", phase: "building", log: "", errors: [] });
    const unlisten = await listen<string>("compile:log", (e) => {
      if (seq !== compileSeq) return; // ignore log chunks from a superseded compile
      set((s) => ({
        log: s.log + e.payload,
        phase: phaseFromLogChunk(e.payload, s.phase),
      }));
    });
    try {
      const result = await compileProject(projectId, mainDoc, offline);
      // Wrap the IPC ArrayBuffer as a view (no copy of the payload bytes).
      const buf = result.has_pdf ? await readCompiledPdf(projectId) : null;
      const bytes = buf ? new Uint8Array(buf) : null;
      if (stale()) return result;
      // Drop the previous PDF buffer so GC can reclaim multi-MB documents.
      set({
        status: bytes ? "success" : "error",
        phase: "idle",
        pdfBytes: bytes,
        errors: result.errors,
        log: result.log,
        lastCompiledAt: Date.now(),
        compileTimeMs: result.compile_time_ms ?? 0,
      });
      // Tell detached windows (PDF preview, other OS windows) to reload.
      void import("@/lib/preview-window").then((m) => m.refreshPreviewWindow());
      void import("@/lib/cross-window").then((m) => m.notifyCompileDone(files.projectId));
      // A successful compile is the natural checkpoint: auto-commit the
      // project (compiling already saved the active file first).
      if (bytes && files.projectId) {
        const pid = files.projectId;
        void import("@/lib/auto-commit").then((m) => m.autoCommitNow(pid));
      }
      return result;
    } catch (e) {
      if (!stale()) set({ status: "error", phase: "idle", log: `Compile failed: ${String(e)}` });
      void import("@/lib/log").then(({ logError }) => logError("compile", e));
      return undefined;
    } finally {
      unlisten();
      if (rerunQueued) {
        rerunQueued = false;
        if (!stale()) void get().recompile();
      }
    }
  },
}));
