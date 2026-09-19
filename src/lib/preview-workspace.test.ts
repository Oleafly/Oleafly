import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  emitTo: vi.fn(async () => {}),
  recompile: vi.fn(async () => {}),
  stopCompile: vi.fn(async () => {}),
  unsubscribe: vi.fn(),
  unsubscribeFiles: vi.fn(),
  setAutoCompile: vi.fn(), setCompileMode: vi.fn(), setCheckSyntaxBeforeCompile: vi.fn(), setStopOnFirstError: vi.fn(),
  setEngine: vi.fn(async () => {}), refreshTree: vi.fn(async () => {}),
  off: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: mocks.emitTo,
  listen: vi.fn(async (name, handler) => { mocks.handlers.set(name, handler); return mocks.off; }),
}));
vi.mock("@/store/files", () => ({ useFilesStore: {
  getState: () => ({ projectId: "current", engine: { id: "latex", label: "LaTeX" }, engineLoaded: true, mainDoc: "main.tex", setEngine: mocks.setEngine, refreshTree: mocks.refreshTree }),
  subscribe: () => mocks.unsubscribeFiles,
} }));
vi.mock("@/store/preview-detached", () => ({ usePreviewDetachedStore: { getState: () => ({ projectId: "current" }) } }));
vi.mock("@/store/compile", () => ({ useCompileStore: {
  getState: () => ({ recompile: mocks.recompile, stopCompile: mocks.stopCompile, status: "success", log: "Build output", errors: [], diagnostics: [], compileTimeMs: 120,
    autoCompile: false, compileMode: "normal", checkSyntaxBeforeCompile: true, stopOnFirstError: false,
    setAutoCompile: mocks.setAutoCompile, setCompileMode: mocks.setCompileMode,
    setCheckSyntaxBeforeCompile: mocks.setCheckSyntaxBeforeCompile, setStopOnFirstError: mocks.setStopOnFirstError }),
  subscribe: () => mocks.unsubscribe,
} }));
import { startPreviewWorkspaceBridge } from "./preview-workspace";

beforeEach(() => { vi.clearAllMocks(); mocks.handlers.clear(); });

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

});
