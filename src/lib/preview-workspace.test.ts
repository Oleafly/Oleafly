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
  setTypstVersion: vi.fn(async (_version: string | null) => {}),
  applyTypstCompileOptions: vi.fn(async (_update: unknown) => {}),
  chooseTypstVariant: vi.fn(),
  setFocus: vi.fn(async () => {}),
  off: vi.fn(),
  files: {} as Record<string, unknown>,
  filesChanged: ((_next: unknown, _previous: unknown) => {}) as (next: unknown, previous: unknown) => void,
  logError: vi.fn(async () => {}),
  errorUnique: vi.fn(),
  notifyError: vi.fn(),
  openFileAndGotoLine: vi.fn(async (_file: string | null, _line: number, _column?: number) => {}),
  askAiAboutCompileErrors: vi.fn(async () => {}),
  openSettingsAt: vi.fn(),
  setSettingsOpen: vi.fn(),
  activeTourId: null as string | null,
  tauri: true,
}));
vi.mock("@/features/synctex", () => ({ openFileAndGotoLine: mocks.openFileAndGotoLine }));
vi.mock("@/features/ask-ai-compile-errors", () => ({ askAiAboutCompileErrors: mocks.askAiAboutCompileErrors }));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: () => ({ openSettingsAt: mocks.openSettingsAt, setSettingsOpen: mocks.setSettingsOpen }) } }));
vi.mock("@/store/tours", () => ({ useTourStore: { getState: () => ({ activeTourId: mocks.activeTourId }) } }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({ toast: { errorUnique: mocks.errorUnique }, notifyError: mocks.notifyError }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.tauri }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setFocus: mocks.setFocus }) }));
vi.mock("@/lib/typst-compile-actions", () => ({
  applyTypstCompileOptions: mocks.applyTypstCompileOptions,
  chooseTypstVariant: mocks.chooseTypstVariant,
}));
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: mocks.emitTo,
  listen: vi.fn(async (name, handler) => { mocks.handlers.set(name, handler); return mocks.off; }),
}));
vi.mock("@/store/files", () => ({ engineSwitchToastKey: (projectId: string) => `engine-switch:${projectId}`, useFilesStore: {
  getState: () => ({ projectId: "current", engine: { id: "latex", label: "LaTeX" }, engineLoaded: true, mainDoc: "main.tex", setEngine: mocks.setEngine, setTypstVersion: mocks.setTypstVersion, refreshTree: mocks.refreshTree, ...mocks.files }),
  subscribe: (listener: (next: unknown, previous: unknown) => void) => { mocks.filesChanged = listener; return mocks.unsubscribeFiles; },
} }));
vi.mock("@/store/preview-detached", () => ({ usePreviewDetachedStore: { getState: () => ({ projectId: mocks.detachedProject }), subscribe: (listener: () => void) => { mocks.detachedChanged = listener; return mocks.unsubscribeDetached; } } }));
vi.mock("@/store/compile", () => ({ useCompileStore: {
  getState: () => ({ recompile: mocks.recompile, stopCompile: mocks.stopCompile, status: "success", log: "Build output", errors: [], diagnostics: [], compileTimeMs: 120,
    lastAttemptIdentity: null, lastCompileCheckpoint: mocks.checkpoint, failureReason: null,
    autoCompile: false, compileMode: "normal", checkSyntaxBeforeCompile: true, stopOnFirstError: false,
    livePreview: { projectId: "current", enabled: false, status: "off", message: null },
    setAutoCompile: mocks.setAutoCompile, setCompileMode: mocks.setCompileMode,
    setCheckSyntaxBeforeCompile: mocks.setCheckSyntaxBeforeCompile, setStopOnFirstError: mocks.setStopOnFirstError }),
  subscribe: () => mocks.unsubscribe,
} }));
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useFolderAccessStore } from "@/store/folder-access";
import { startPreviewWorkspaceBridge } from "./preview-workspace";

const untrusted = { trusted: false, source: null, parent: null, repository: null };
const trusted = { trusted: true, source: "folder", parent: null, repository: null };

beforeEach(() => {
  vi.clearAllMocks(); mocks.handlers.clear(); mocks.detachedProject = "current"; mocks.checkpoint = null; mocks.detachedChanged = () => {};
  mocks.files = {}; mocks.filesChanged = () => {}; mocks.tauri = true; mocks.activeTourId = null;
  useFolderAccessStore.getState().reset(null);
});

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
      noMainDocument: false, systemTexLocked: false,
      typstVariant: null, livePreview: { projectId: "current", enabled: false, status: "off", message: null },
    });
    cleanup();
  });

  it("tells the detached window that the folder has no main document and is not trusted yet", async () => {
    mocks.files = { manifestHome: "folder", tree: [{ path: "notes/draft.md", is_dir: false }] };
    useFolderAccessStore.getState().reset("current");
    useFolderAccessStore.setState({ loaded: true, trust: untrusted as never });
    const cleanup = await startPreviewWorkspaceBridge();
    mocks.handlers.get("preview:command")?.({ payload: { projectId: "current", action: "ready" } });
    expect(mocks.emitTo).toHaveBeenCalledWith("preview", "preview:workspace", expect.objectContaining({
      noMainDocument: true, systemTexLocked: true,
    }));
    cleanup();
  });

  it("republishes when trust or the main document changes, and trusts the folder for the detached window", async () => {
    vi.useFakeTimers();
    useFolderAccessStore.getState().reset("current");
    useFolderAccessStore.setState({ loaded: true, trust: untrusted as never });
    const cleanup = await startPreviewWorkspaceBridge();
    try {
      useFolderAccessStore.setState({ trust: trusted as never });
      await vi.runAllTimersAsync();
      expect(mocks.emitTo).toHaveBeenLastCalledWith("preview", "preview:workspace", expect.objectContaining({ systemTexLocked: false }));

      mocks.emitTo.mockClear();
      const before = { projectId: "current", manifestHome: "folder", mainDoc: "main.tex", tree: [] };
      mocks.files = { manifestHome: "folder", tree: [{ path: "main.tex", is_dir: false }] };
      mocks.filesChanged({ ...before, tree: [{ path: "main.tex", is_dir: false }] }, before);
      await vi.runAllTimersAsync();
      expect(mocks.emitTo).toHaveBeenLastCalledWith("preview", "preview:workspace", expect.objectContaining({ noMainDocument: false }));

      const grant = vi.fn(async () => true);
      useFolderAccessStore.setState({ grant });
      mocks.handlers.get("preview:command")?.({ payload: { projectId: "current", action: "trust-folder" } });
      await vi.waitFor(() => expect(grant).toHaveBeenCalledWith("folder"));
    } finally {
      cleanup();
      vi.useRealTimers();
    }
    mocks.emitTo.mockClear();
    useFolderAccessStore.setState({ trust: untrusted as never });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(mocks.emitTo).not.toHaveBeenCalled();
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

  it("says why when a read-only folder refuses the engine switch", async () => {
    mocks.setEngine.mockRejectedValueOnce(`@oleafly/error:${JSON.stringify({
      code: "project.folder_read_only",
      params: { name: "project.json" },
      detail: null,
    })}`);
    const cleanup = await startPreviewWorkspaceBridge();
    mocks.handlers.get("preview:command")?.({ payload: { projectId: "current", action: "engine", engine: "xetex" } });

    await vi.waitFor(() => expect(mocks.errorUnique).toHaveBeenCalledOnce());
    expect(mocks.errorUnique).toHaveBeenCalledWith(
      "engine-switch:current",
      "Oleafly can't make this change because project.json or its folder is read-only. Copy the folder you opened into your library and edit it there.",
    );
    cleanup();
  });

  it("pins the Typst version the detached menu chose", async () => {
    const cleanup = await startPreviewWorkspaceBridge();
    const command = (payload: unknown) => mocks.handlers.get("preview:command")?.({ payload });
    command({ projectId: "current", action: "typst-version", version: 7 });
    command({ projectId: "current", action: "typst-version", version: "0.13.1" });
    command({ projectId: "current", action: "typst-version", version: null });
    await vi.waitFor(() => expect(mocks.setTypstVersion).toHaveBeenCalledTimes(2));
    expect(mocks.setTypstVersion).toHaveBeenNthCalledWith(1, "0.13.1");
    expect(mocks.setTypstVersion).toHaveBeenNthCalledWith(2, null);
    cleanup();
  });

  it("reports a failed Typst version switch once, in the slot the toolbar shares", async () => {
    mocks.setTypstVersion.mockRejectedValueOnce(new Error("not a Typst project"));
    const cleanup = await startPreviewWorkspaceBridge();
    mocks.handlers.get("preview:command")?.({ payload: { projectId: "current", action: "typst-version", version: "0.13.1" } });
    await vi.waitFor(() => expect(mocks.errorUnique).toHaveBeenCalledOnce());
    expect(mocks.errorUnique).toHaveBeenCalledWith("engine-switch:current", enShell.compile.typstVersion.switchFailed);
    cleanup();
  });

  it("saves the Typst font and build choices from the detached menu and rejects anything else", async () => {
    const cleanup = await startPreviewWorkspaceBridge();
    const command = (payload: unknown) => mocks.handlers.get("preview:command")?.({ payload });
    command({ projectId: "current", action: "typst-options", systemFonts: "no" });
    command({ projectId: "current", action: "typst-options" });
    command({ projectId: "old", action: "typst-options", systemFonts: false });
    command({ projectId: "current", action: "typst-options", systemFonts: false });
    command({ projectId: "current", action: "typst-options", reproducible: true, fontPaths: ["/etc"] });
    await vi.waitFor(() => expect(mocks.applyTypstCompileOptions).toHaveBeenCalledTimes(2));
    expect(mocks.applyTypstCompileOptions).toHaveBeenNthCalledWith(1, { systemFonts: false });
    expect(mocks.applyTypstCompileOptions).toHaveBeenNthCalledWith(2, { reproducible: true });
    cleanup();
  });

  it("picks only a variant the project defines", async () => {
    mocks.files = { engine: { id: "typst", label: "Typst", source_format: "typst", typst_options: { variants: ["draft"] } } };
    const cleanup = await startPreviewWorkspaceBridge();
    const command = (payload: unknown) => mocks.handlers.get("preview:command")?.({ payload });
    command({ projectId: "current", action: "typst-variant", variant: 3 });
    command({ projectId: "current", action: "typst-variant", variant: "missing" });
    command({ projectId: "current", action: "typst-variant", variant: "draft" });
    command({ projectId: "current", action: "typst-variant", variant: null });
    await vi.waitFor(() => expect(mocks.chooseTypstVariant).toHaveBeenCalledTimes(2));
    expect(mocks.chooseTypstVariant).toHaveBeenNthCalledWith(1, "draft");
    expect(mocks.chooseTypstVariant).toHaveBeenNthCalledWith(2, null);
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

  it("opens the PDF settings and focuses the main window", async () => {
    const cleanup = await startPreviewWorkspaceBridge();
    mocks.handlers.get("preview:command")?.({ payload: { projectId: "current", action: "pdf-settings" } });
    await vi.waitFor(() => expect(mocks.setFocus).toHaveBeenCalledOnce());
    expect(mocks.openSettingsAt).toHaveBeenCalledWith("appearance", "pdf");
    cleanup();
  });

  it("opens Settings in the main window when the detached preview asks, but not during a tour", async () => {
    const cleanup = await startPreviewWorkspaceBridge();
    mocks.handlers.get("preview:command")?.({ payload: { projectId: "current", action: "settings" } });
    await vi.waitFor(() => expect(mocks.setFocus).toHaveBeenCalledOnce());
    expect(mocks.setSettingsOpen).toHaveBeenCalledWith(true);

    mocks.activeTourId = "welcome";
    mocks.handlers.get("preview:command")?.({ payload: { projectId: "current", action: "settings" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.setSettingsOpen).toHaveBeenCalledOnce();
    expect(mocks.setFocus).toHaveBeenCalledOnce();
    cleanup();
  });

  it("jumps to a source location from the detached preview and ignores invalid locations", async () => {
    const cleanup = await startPreviewWorkspaceBridge();
    const command = (payload: unknown) => mocks.handlers.get("preview:command")?.({ payload });
    command({ projectId: "current", action: "source-location", file: 5, line: 3 });
    command({ projectId: "current", action: "source-location", file: "a.tex", line: 0 });
    command({ projectId: "current", action: "source-location", file: "a.tex", line: 2.5 });
    command({ projectId: "current", action: "source-location", file: "chapters/a.tex", line: 12, column: 4 });
    await vi.waitFor(() => expect(mocks.setFocus).toHaveBeenCalledOnce());
    command({ projectId: "current", action: "source-location", file: null, line: 3, column: 0 });
    await vi.waitFor(() => expect(mocks.setFocus).toHaveBeenCalledTimes(2));
    expect(mocks.openFileAndGotoLine.mock.calls).toEqual([
      ["chapters/a.tex", 12, 4],
      [null, 3, undefined],
    ]);
    cleanup();
  });

  it("asks the assistant about compile errors and focuses the main window", async () => {
    const cleanup = await startPreviewWorkspaceBridge();
    mocks.handlers.get("preview:command")?.({ payload: { projectId: "current", action: "ask-ai" } });
    await vi.waitFor(() => expect(mocks.setFocus).toHaveBeenCalledOnce());
    expect(mocks.askAiAboutCompileErrors).toHaveBeenCalledOnce();
    cleanup();
  });

  it("ignores commands without a project and starts no bridge outside the desktop shell", async () => {
    const cleanup = await startPreviewWorkspaceBridge();
    mocks.handlers.get("preview:command")?.({ payload: { action: "compile" } });
    mocks.handlers.get("preview:command")?.({ payload: null });
    expect(mocks.recompile).not.toHaveBeenCalled();
    cleanup();

    mocks.handlers.clear();
    mocks.tauri = false;
    const noop = await startPreviewWorkspaceBridge();
    expect(mocks.handlers.size).toBe(0);
    noop();
  });

  it("publishes once for a burst of changes and skips file changes that do not affect the preview", async () => {
    vi.useFakeTimers();
    try {
      const cleanup = await startPreviewWorkspaceBridge();
      const files = { engine: { id: "latex" }, engineLoaded: true, mainDoc: "main.tex", tree: [] };
      mocks.filesChanged({ ...files, activePath: "b.tex" }, { ...files, activePath: "a.tex" });
      vi.advanceTimersByTime(200);
      expect(mocks.emitTo).not.toHaveBeenCalled();
      mocks.detachedChanged();
      mocks.detachedChanged();
      mocks.filesChanged({ ...files, mainDoc: "other.tex" }, files);
      vi.advanceTimersByTime(100);
      expect(mocks.emitTo).toHaveBeenCalledOnce();
      cleanup();
    } finally {
      vi.useRealTimers();
    }
  });
});
