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

export type CompileStatus = "idle" | "compiling" | "success" | "error";

interface CompileState {
  status: CompileStatus;
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

export const useCompileStore = create<CompileState>((set) => ({
  status: "idle",
  log: "",
  errors: [],
  pdfBytes: null,
  lastCompiledAt: null,
  compileTimeMs: null,
  autoCompile: false,
  setAutoCompile: (v) => set({ autoCompile: v }),
  reset: () =>
    set({
      status: "idle",
      log: "",
      errors: [],
      pdfBytes: null,
      lastCompiledAt: null,
      compileTimeMs: null,
    }),
  recompile: async () => {
    const files = useFilesStore.getState();
    await files.saveActive();

    const projectId = files.projectId ?? "default";
    const mainDoc = files.mainDoc || "main.tex";
    const offline = useSettingsStore.getState().offline;

    set({ status: "compiling", log: "", errors: [] });
    const unlisten = await listen<string>("compile:log", (e) => {
      set((s) => ({ log: s.log + e.payload }));
    });
    try {
      const result = await compileProject(projectId, mainDoc, offline);
      const bytes = result.has_pdf
        ? new Uint8Array(await readCompiledPdf(projectId))
        : null;
      set({
        status: bytes ? "success" : "error",
        pdfBytes: bytes,
        errors: result.errors,
        log: result.log,
        lastCompiledAt: Date.now(),
        compileTimeMs: result.compile_time_ms ?? 0,
      });
      return result;
    } catch (e) {
      set({ status: "error", log: `Compile failed: ${String(e)}` });
      void import("@/lib/log").then(({ logError }) => logError("compile", e));
      return undefined;
    } finally {
      unlisten();
    }
  },
}));
