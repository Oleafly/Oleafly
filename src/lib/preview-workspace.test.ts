import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCompileSuccessCheckpoint, type CompileSuccessCheckpoint } from "@/lib/compile-checkpoint";

const mocks = vi.hoisted(() => ({
  detachedProject: "current" as string | null,
  checkpoint: null as CompileSuccessCheckpoint | null,
  detachedChanged: (() => {}) as () => void,
  unsubscribeDetached: vi.fn(),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  emitTo: vi.fn(async () => {}),
  recompile: vi.fn(async () => {}),
  stopCompile: vi.fn(async () => {}),
  unsubscribe: vi.fn(),
  unsubscribeFiles: vi.fn(),
  setAutoCompile: vi.fn(), setCompileMode: vi.fn(), setCheckSyntaxBeforeCompile: vi.fn(), setStopOnFirstError: vi.fn(),
  setEngine: vi.fn(async () => {}), refreshTree: vi.fn(async () => {}),
  off: vi.fn(),
  logError: vi.fn(async () => {}),
  errorUnique: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({ toast: { errorUnique: mocks.errorUnique }, notifyError: mocks.notifyError }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: mocks.emitTo,
  listen: vi.fn(async (name, handler) => { mocks.handlers.set(name, handler); return mocks.off; }),
}));
vi.mock("@/store/files", () => ({ engineSwitchToastKey: (projectId: string) => `engine-switch:${projectId}`, useFilesStore: {
  getState: () => ({ projectId: "current", engine: { id: "latex", label: "LaTeX" }, engineLoaded: true, mainDoc: "main.tex", setEngine: mocks.setEngine, refreshTree: mocks.refreshTree }),
  subscribe: () => mocks.unsubscribeFiles,
} }));
vi.mock("@/store/preview-detached", () => ({ usePreviewDetachedStore: { getState: () => ({ projectId: mocks.detachedProject }), subscribe: (listener: () => void) => { mocks.detachedChanged = listener; return mocks.unsubscribeDetached; } } }));
vi.mock("@/store/compile", () => ({ useCompileStore: {
  getState: () => ({ recompile: mocks.recompile, stopCompile: mocks.stopCompile, status: "success", log: "Build output", errors: [], diagnostics: [], compileTimeMs: 120,
    lastAttemptIdentity: null, lastCompileCheckpoint: mocks.checkpoint, failureReason: null,
    autoCompile: false, compileMode: "normal", checkSyntaxBeforeCompile: true, stopOnFirstError: false,
    setAutoCompile: mocks.setAutoCompile, setCompileMode: mocks.setCompileMode,
    setCheckSyntaxBeforeCompile: mocks.setCheckSyntaxBeforeCompile, setStopOnFirstError: mocks.setStopOnFirstError }),
  subscribe: () => mocks.unsubscribe,
} }));
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { startPreviewWorkspaceBridge } from "./preview-workspace";

beforeEach(() => { vi.clearAllMocks(); mocks.handlers.clear(); mocks.detachedProject = "current"; mocks.checkpoint = null; mocks.detachedChanged = () => {}; });

describe("detached compile commands", () => {
  it("uses the main compile action and ignores commands for a previous project", async () => {
    const cleanup = await startPreviewWorkspaceBridge();
    const command = mocks.handlers.get("preview:command");
    command?.({ payload: { projectId: "old", action: "compile" } });
    expect(mocks.recompile).not.toHaveBeenCalled();
    command?.({ payload: { projectId: "current", action: "compile" } });
    expect(mocks.recompile).toHaveBeenCalledOnce();
    command?.({ payload: { projectId: "current", action: "stop" } });
    expect(mocks.stopCompile).toHaveBeenCalledOnce();
    cleanup();
    expect(mocks.off).toHaveBeenCalledOnce();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.unsubscribeFiles).toHaveBeenCalledOnce();
  });

  it("sends the current log when the detached window is ready", async () => {
    const cleanup = await startPreviewWorkspaceBridge();
    mocks.handlers.get("preview:command")?.({ payload: { projectId: "current", action: "ready" } });
    expect(mocks.emitTo).toHaveBeenCalledWith("preview", "preview:workspace", {
      projectId: "current", status: "success", log: "Build output", errors: [], diagnostics: [], compileTimeMs: 120,
      compileRevision: 0, autoCompile: false, compileMode: "normal", checkSyntaxBeforeCompile: true, stopOnFirstError: false,
      engine: { id: "latex", label: "LaTeX" }, engineLoaded: true, mainDoc: "main.tex",
    });
    cleanup();
  });
  it("publishes controls if the preview asks before the window-created event", async () => {
    vi.useFakeTimers();
    mocks.detachedProject = null;
    const cleanup = await startPreviewWorkspaceBridge();
    try {
      mocks.handlers.get("preview:command")?.({ payload: { projectId: "current", action: "ready" } });
      expect(mocks.emitTo).not.toHaveBeenCalled();
      mocks.detachedProject = "current";
      mocks.detachedChanged();
      await vi.runAllTimersAsync();
      expect(mocks.emitTo).toHaveBeenCalledWith("preview", "preview:workspace", expect.objectContaining({ engineLoaded: true, log: "Build output" }));
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("replays a completed PDF when a restored window missed the compile event", async () => {
    const checkpoint = createCompileSuccessCheckpoint({
      projectId: "current", mainDocument: "main.tex", projectRevision: 3, requestGeneration: 4,
      outputKind: "standard", producerId: "main", outputRevision: 7, outputId: "pdf-v1:test", previousCompletedAt: null,
    });
    mocks.checkpoint = checkpoint;
    const cleanup = await startPreviewWorkspaceBridge();
    try {
      mocks.handlers.get("preview:command")?.({ payload: { projectId: "current", action: "ready" } });
      expect(mocks.emitTo).toHaveBeenCalledWith("preview", "preview:workspace", expect.objectContaining({
        previewState: {
          projectStateRevision: 0, status: "success", checkpoint,
          identity: { projectId: "current", mainDocument: "main.tex", projectRevision: 3, requestGeneration: 4 },
        },
      }));
      mocks.checkpoint = { ...checkpoint, projectId: "old" };
      mocks.emitTo.mockClear();
      mocks.handlers.get("preview:command")?.({ payload: { projectId: "current", action: "ready" } });
      expect(mocks.emitTo).toHaveBeenCalledWith("preview", "preview:workspace", expect.objectContaining({ previewState: undefined }));
    } finally {
      cleanup();
    }
  });

  it("routes compile options to the main window and rejects invalid values", async () => {
    const cleanup = await startPreviewWorkspaceBridge();
    const command = (payload: unknown) => mocks.handlers.get("preview:command")?.({ payload });
    command({ projectId: "old", action: "auto-compile", value: true });
    command({ projectId: "current", action: "auto-compile", value: "true" });
    expect(mocks.setAutoCompile).not.toHaveBeenCalled();
    command({ projectId: "current", action: "auto-compile", value: true });
    command({ projectId: "current", action: "compile-mode", value: "fast" });
    command({ projectId: "current", action: "syntax-check", value: false });
    command({ projectId: "current", action: "stop-on-error", value: true });
    command({ projectId: "current", action: "compile", fromScratch: true });
    expect(mocks.setAutoCompile).toHaveBeenCalledWith(true);
    expect(mocks.setCompileMode).toHaveBeenCalledWith("fast");
    expect(mocks.setCheckSyntaxBeforeCompile).toHaveBeenCalledWith(false);
    expect(mocks.setStopOnFirstError).toHaveBeenCalledWith(true);
    expect(mocks.recompile).toHaveBeenCalledWith({ fromScratch: true });
    command({ projectId: "current", action: "engine", engine: "latexmk", flavor: "xelatex" });
    expect(mocks.setEngine).toHaveBeenCalledWith("latexmk", "xelatex");
    command({ projectId: "current", action: "engine", engine: "latexmk", flavor: "invalid" });
    expect(mocks.setEngine).toHaveBeenCalledOnce();
    cleanup();
  });

  it("reports a failed engine switch once, in the slot the toolbar shares", async () => {
    const failure = new Error("latexmk is not installed");
    mocks.setEngine.mockRejectedValueOnce(failure);
    const cleanup = await startPreviewWorkspaceBridge();
    mocks.handlers.get("preview:command")?.({ payload: { projectId: "current", action: "engine", engine: "xetex" } });

    await vi.waitFor(() => expect(mocks.errorUnique).toHaveBeenCalledOnce());
    expect(mocks.errorUnique).toHaveBeenCalledWith("engine-switch:current", enShell.enginePicker.switchFailed);
    expect(mocks.logError).toHaveBeenCalledWith("preview command engine", failure);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    cleanup();
  });

  it("only logs failures of the other preview commands", async () => {
    mocks.recompile.mockRejectedValueOnce(new Error("compile queue closed"));
    mocks.refreshTree.mockRejectedValueOnce(new Error("tree unavailable"));
    const cleanup = await startPreviewWorkspaceBridge();
    const command = (payload: unknown) => mocks.handlers.get("preview:command")?.({ payload });
    command({ projectId: "current", action: "compile" });
    command({ projectId: "current", action: "refresh-files" });

    await vi.waitFor(() => expect(mocks.logError).toHaveBeenCalledTimes(2));
    expect(mocks.logError).toHaveBeenCalledWith("preview command compile", expect.any(Error));
    expect(mocks.logError).toHaveBeenCalledWith("preview command refresh-files", expect.any(Error));
    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
    cleanup();
  });
});
