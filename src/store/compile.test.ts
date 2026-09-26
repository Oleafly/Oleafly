import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { CompileResult, LogDiagnostic } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({
  latexEngineInfo: vi.fn(),
  tlmgrInstallMissing: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
  infoUnique: vi.fn((_key: string, _message: string, _action?: unknown, _sticky?: boolean) => 0),
  errorUnique: vi.fn((_key: string, _message: string, _action?: unknown, _sticky?: boolean) => 0),
  dismiss: vi.fn(),
  notifyError: vi.fn(),
  logError: vi.fn(),
  reportFileSaveFailure: vi.fn(),
  projectCompatibilityFindings: vi.fn((_projectId: string): unknown[] => []),
  texDistributionGapNotice: vi.fn((_projectId: string): string | null => null),
  fileListeners: new Set<(state: unknown) => void>(),
  refreshPackages: vi.fn(),
  events: new Map<string, (event: { payload: string }) => void>(),
  listen: vi.fn(
    async (name: string, handler: (event: { payload: string }) => void) => {
      mocks.events.set(name, handler);
      return () => mocks.events.delete(name);
    },
  ),
  compileProject: vi.fn(),
  readCompiledPdf: vi.fn(),
  validateCompileFingerprint: vi.fn(),
  readFileContent: vi.fn(),
  cancelCompile: vi.fn(),
  clearBuildDir: vi.fn(),
  notifyCompileSucceeded: vi.fn(),
  refreshPreviewWindow: vi.fn(),
  gitPreparePublish: vi.fn(),
  ensurePandoc: vi.fn(),
  saveActive: vi.fn(),
  readProjectSources: vi.fn(),
  settings: {
    offline: false,
  },
  index: {
    texts: {
      "main.tex": "\\documentclass{article}\n",
    } as Record<string, string>,
    filesystemEpoch: 0,
  },
  files: {
    projectId: "project" as string | null,
    activePath: "main.tex" as string | null,
    mainDoc: "main.tex",
    engine: null as unknown,
    engineLoaded: true,
    engineError: null as string | null,
    loading: false,
    tree: [{ path: "main.tex", is_dir: false }],
    files: {
      "main.tex": {
        content: "\\documentclass{article}\n",
        dirty: false,
      },
    } as Record<string, { content: string; dirty: boolean }>,
    saveActive: vi.fn(),
  },
}));

vi.mock("@/lib/tauri", () => ({
  latexEngineInfo: mocks.latexEngineInfo,
  tlmgrInstallMissing: mocks.tlmgrInstallMissing,
  compileProject: mocks.compileProject,
  readCompiledPdf: mocks.readCompiledPdf,
  validateCompileFingerprint: mocks.validateCompileFingerprint,
  readFileContent: mocks.readFileContent,
  cancelCompile: mocks.cancelCompile,
  clearBuildDir: mocks.clearBuildDir,
  gitPreparePublish: mocks.gitPreparePublish,
}));
vi.mock("@/features/pandoc", () => ({ ensurePandoc: mocks.ensurePandoc }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@/store/files", () => ({
  engineErrorMessage: (reason: string) => `engine error: ${reason}`,
  projectCompatibilityFindings: mocks.projectCompatibilityFindings,
  reportFileSaveFailure: mocks.reportFileSaveFailure,
  texDistributionGapNotice: mocks.texDistributionGapNotice,
  useFilesStore: {
    getState: () => mocks.files,
    subscribe: (listener: (state: unknown) => void) => {
      mocks.fileListeners.add(listener);
      return () => mocks.fileListeners.delete(listener);
    },
  },
}));
vi.mock("@/store/project-index", () => ({
  currentProjectSourcePaths: () =>
    [
      ...new Set([
        ...mocks.files.tree
          .filter((entry) => !entry.is_dir)
          .map((entry) => entry.path),
        mocks.files.mainDoc,
      ]),
    ].sort(),
  projectFilesystemEpoch: () => mocks.index.filesystemEpoch,
  readProjectSources: mocks.readProjectSources,
  useIndexStore: { getState: () => mocks.index },
}));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: () => mocks.settings } }));
vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: {
    error: mocks.toastError,
    info: mocks.toastInfo,
    infoUnique: mocks.infoUnique,
    errorUnique: mocks.errorUnique,
    dismiss: mocks.dismiss,
  },
}));
vi.mock("@/store/engine", () => ({ useEngineStore: { getState: () => ({ refreshPackages: mocks.refreshPackages }) } }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/preview-window", () => ({
  refreshPreviewWindow: mocks.refreshPreviewWindow,
}));
vi.mock("@/lib/cross-window", () => ({
  currentCompileProducerId: () => "test-window",
  notifyCompileSucceeded: mocks.notifyCompileSucceeded,
}));

import { importCompatFinding } from "@oleafly/latex";
import {
  acceptCompileOffer,
  installerNotices,
  isCompileCheckpointCurrent,
  saveActiveForCompile,
  stopRunningCompileQuietly,
  useCompileStore,
} from "./compile";
import { useEnginePickerStore } from "@/store/engine-picker";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import {
  createCompileSuccessCheckpoint,
  fingerprintCompileOutput,
} from "@/lib/compile-checkpoint";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function checkpoint(bytes: Uint8Array, outputRevision: number) {
  return createCompileSuccessCheckpoint({
    projectId: "project",
    mainDocument: "main.tex",
    outputKind: "standard",
    producerId: "remote-window",
    outputRevision,
    outputId: fingerprintCompileOutput(bytes),
    previousCompletedAt: 100,
    now: 100 + outputRevision,
  });
}

let toastId = 0;

function notifyFiles(): void {
  for (const listener of [...mocks.fileListeners]) listener(mocks.files);
}

beforeEach(() => {
  mocks.infoUnique.mockReset().mockImplementation(() => ++toastId);
  mocks.errorUnique.mockReset().mockImplementation(() => ++toastId);
  mocks.dismiss.mockReset();
  mocks.toastInfo.mockReset();
  mocks.toastError.mockReset();
  mocks.notifyError.mockReset();
  mocks.logError.mockReset();
  mocks.reportFileSaveFailure.mockReset();
  mocks.projectCompatibilityFindings.mockReset().mockReturnValue([]);
  mocks.texDistributionGapNotice.mockReset().mockReturnValue(null);
  mocks.fileListeners.clear();
  mocks.events.clear();
  mocks.listen.mockClear();
  mocks.compileProject.mockReset();
  mocks.readCompiledPdf.mockReset();
  mocks.validateCompileFingerprint.mockReset().mockResolvedValue(null);
  mocks.readFileContent.mockReset().mockResolvedValue("\\documentclass{article}\n");
  mocks.cancelCompile.mockReset().mockResolvedValue(true);
  mocks.clearBuildDir.mockReset().mockResolvedValue(undefined);
  mocks.notifyCompileSucceeded.mockReset();
  mocks.refreshPreviewWindow.mockReset();
  mocks.gitPreparePublish.mockReset().mockResolvedValue(undefined);
  mocks.ensurePandoc.mockReset().mockResolvedValue(true);
  mocks.saveActive.mockReset().mockResolvedValue(undefined);
  mocks.readProjectSources.mockReset().mockImplementation(
    async (_projectId: string, paths: readonly string[]) => ({
      texts: Object.fromEntries(
        paths.map((path) => [
          path,
          mocks.files.files[path]?.content ??
            mocks.index.texts[path] ??
            "",
        ]),
      ),
      unreadable: new Set<string>(),
    }),
  );
  mocks.files.saveActive = mocks.saveActive;
  mocks.files.projectId = "project";
  mocks.files.activePath = "main.tex";
  mocks.files.mainDoc = "main.tex";
  mocks.files.engine = LATEX_ENGINE;
  mocks.files.engineLoaded = true;
  mocks.files.engineError = null;
  mocks.files.loading = false;
  mocks.files.tree = [{ path: "main.tex", is_dir: false }];
  mocks.files.files = {
    "main.tex": {
      content: "\\documentclass{article}\n",
      dirty: false,
    },
  };
  mocks.index.texts = {
    "main.tex": "\\documentclass{article}\n",
  };
  mocks.index.filesystemEpoch = 0;
  mocks.settings.offline = false;
  useProjectAnalysisStore.getState().reset();
  useProjectAnalysisStore.getState().activateProject({
    projectId: "project",
    projectRevision: 0,
    languageServiceGeneration: 0,
  });
  useCompileStore.getState().reset();
  useCompileStore.setState({
    compileMode: "normal",
    checkSyntaxBeforeCompile: true,
    stopOnFirstError: false,
  });
});

describe("compile output lifecycle", () => {
  it("coalesces bursty compiler output so WebKit gets a paint frame", async () => {
    // This case measures log buffering; syntax validation has separate cases
    // below and lazily loads the language service on the first compile.
    useCompileStore.setState({ checkSyntaxBeforeCompile: false });
    const compile = deferred<{
      ok: boolean;
      has_pdf: boolean;
      output_id: null;
      output_revision: null;
      log: string;
      errors: never[];
      synctex_path: null;
      out_dir: null;
      compile_time_ms: number;
    }>();
    mocks.compileProject.mockReturnValue(compile.promise);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    try {
      const compiling = useCompileStore.getState().recompile();
      await vi.waitFor(() => expect(mocks.events.has("compile:log")).toBe(true));

      mocks.events.get("compile:log")?.({ payload: "first\n" });
      mocks.events.get("compile:log")?.({ payload: "second\n" });
      mocks.events.get("compile:log")?.({ payload: "third\n" });

      expect(frames).toHaveLength(1);
      expect(useCompileStore.getState().log).toBe("");
      frames[0](16);
      expect(useCompileStore.getState().log).toBe("first\nsecond\nthird\n");

      compile.resolve({
        ok: false,
        has_pdf: false,
        output_id: null,
        output_revision: null,
        log: "first\nsecond\nthird\n",
        errors: [],
        synctex_path: null,
        out_dir: null,
        compile_time_ms: 12,
      });
      await compiling;
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("timestamps and broadcasts the exact verified successful output", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    mocks.compileProject.mockResolvedValue({
      ok: true,
      has_pdf: true,
      output_id: fingerprintCompileOutput(bytes),
      output_revision: 7,
      log: "ok",
      errors: [],
      synctex_path: null,
      out_dir: "/build",
      compile_time_ms: 12,
    });
    mocks.readCompiledPdf.mockResolvedValue(bytes.buffer);
    useCompileStore.setState({ lastCompiledAt: 123 });

    await useCompileStore.getState().recompile();

    const state = useCompileStore.getState();
    expect(state.status).toBe("success");
    expect(state.pdfBytes).toEqual(bytes);
    expect(state.lastCompiledAt).toBeGreaterThan(123);
    expect(state.lastCompileCheckpoint).toEqual(
      expect.objectContaining({
        version: 1,
        projectId: "project",
        mainDocument: "main.tex",
        outputKind: "standard",
        producerId: "test-window",
        outputRevision: 7,
        outputId: fingerprintCompileOutput(bytes),
        completedAt: state.lastCompiledAt,
      }),
    );
    expect(mocks.notifyCompileSucceeded).toHaveBeenCalledTimes(1);
    expect(mocks.notifyCompileSucceeded).toHaveBeenCalledWith(
      state.lastCompileCheckpoint,
    );
  });

  it("does not create a Git commit after a successful compile", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    mocks.compileProject.mockResolvedValue({
      ok: true,
      has_pdf: true,
      output_id: fingerprintCompileOutput(bytes),
      output_revision: 7,
      log: "ok",
      errors: [],
      synctex_path: null,
      out_dir: "/build",
      compile_time_ms: 12,
    });
    mocks.readCompiledPdf.mockResolvedValue(bytes.buffer);

    await useCompileStore.getState().recompile();

    expect(mocks.gitPreparePublish).not.toHaveBeenCalled();
  });

  it("restores preview and SyncTeX freshness after source text is exactly reverted", async () => {
    const original = "\\documentclass{article}\n";
    const bytes = new Uint8Array([1, 2, 3]);
    mocks.compileProject.mockResolvedValue({
      ok: true,
      has_pdf: true,
      output_id: fingerprintCompileOutput(bytes),
      output_revision: 7,
      log: "ok",
      errors: [],
      synctex_path: null,
      out_dir: "/build",
      compile_time_ms: 12,
    });
    mocks.readCompiledPdf.mockResolvedValue(bytes.buffer);

    await useCompileStore.getState().recompile();
    const checkpoint =
      useCompileStore.getState().lastCompileCheckpoint;
    expect(isCompileCheckpointCurrent(checkpoint)).toBe(true);

    mocks.files.files["main.tex"].content = `${original}abc`;
    mocks.files.files["main.tex"].dirty = true;
    mocks.index.texts["main.tex"] = `${original}abc`;
    useProjectAnalysisStore.getState().setProjectRevision(1);
    expect(isCompileCheckpointCurrent(checkpoint)).toBe(false);

    mocks.files.files["main.tex"].content = original;
    mocks.index.texts["main.tex"] = original;
    useProjectAnalysisStore.getState().setProjectRevision(2);
    expect(isCompileCheckpointCurrent(checkpoint)).toBe(true);
  });

  it("does not restore freshness across a project filesystem invalidation", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    mocks.compileProject.mockResolvedValue({
      ok: true,
      has_pdf: true,
      output_id: fingerprintCompileOutput(bytes),
      output_revision: 7,
      log: "ok",
      errors: [],
      synctex_path: null,
      out_dir: "/build",
      compile_time_ms: 12,
    });
    mocks.readCompiledPdf.mockResolvedValue(bytes.buffer);

    await useCompileStore.getState().recompile();
    const checkpoint =
      useCompileStore.getState().lastCompileCheckpoint;
    mocks.index.filesystemEpoch++;
    useProjectAnalysisStore.getState().setProjectRevision(1);

    expect(isCompileCheckpointCurrent(checkpoint)).toBe(false);
  });

  it("releases intent when the engine is unloaded so a loaded retry can compile", async () => {
    mocks.files.engineLoaded = false;
    await useCompileStore.getState().recompile();
    mocks.files.engineLoaded = true;
    mocks.compileProject.mockResolvedValue({ ok: false, has_pdf: false, log: "", errors: [], synctex_path: null, out_dir: null, compile_time_ms: 1 });
    await useCompileStore.getState().recompile();
    expect(mocks.compileProject).toHaveBeenCalledOnce();
  });

  it("waits for a loading engine and compiles once it is ready, without a toast", async () => {
    mocks.files.engineLoaded = false;
    mocks.compileProject.mockResolvedValue({ ok: false, has_pdf: false, log: "", errors: [], synctex_path: null, out_dir: null, compile_time_ms: 1 });
    await useCompileStore.getState().recompile();
    await useCompileStore.getState().recompile();
    expect(useCompileStore.getState().status).toBe("unavailable");
    expect(mocks.compileProject).not.toHaveBeenCalled();
    expect(mocks.fileListeners.size).toBe(1);
    notifyFiles();
    expect(mocks.compileProject).not.toHaveBeenCalled();
    mocks.files.engineLoaded = true;
    notifyFiles();
    await vi.waitFor(() => expect(mocks.compileProject).toHaveBeenCalledOnce());
    expect(mocks.fileListeners.size).toBe(0);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.errorUnique).not.toHaveBeenCalled();
  });

  it("drops the queued compile when another project opens before the engine loads", async () => {
    mocks.files.engineLoaded = false;
    await useCompileStore.getState().recompile();
    mocks.files.projectId = "another-project";
    notifyFiles();
    expect(mocks.fileListeners.size).toBe(0);
    mocks.files.engineLoaded = true;
    notifyFiles();
    await vi.dynamicImportSettled();
    expect(mocks.compileProject).not.toHaveBeenCalled();
  });

  it("keeps an engine that failed to load in the status and the log", async () => {
    mocks.files.engineLoaded = false;
    mocks.files.engineError = "loadFailed";
    for (let attempt = 0; attempt < 3; attempt++) {
      await useCompileStore.getState().recompile();
    }
    expect(useCompileStore.getState()).toMatchObject({
      status: "unavailable",
      failureReason: "engine error: loadFailed",
    });
    expect(mocks.logError).toHaveBeenCalledWith("compile", "engine error: loadFailed");
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.fileListeners.size).toBe(0);
    expect(mocks.compileProject).not.toHaveBeenCalled();
  });
  it("keeps the last good PDF visible while a new compile runs", async () => {
    let rejectCompile: ((reason: Error) => void) | undefined;
    mocks.compileProject.mockReturnValue(new Promise((_resolve, reject) => { rejectCompile = reject; }));
    useCompileStore.setState({ pdfBytes: new Uint8Array([1]), lastCompiledAt: 123 });
    const running = useCompileStore.getState().recompile();
    await vi.waitFor(() => expect(mocks.compileProject).toHaveBeenCalled());
    expect(useCompileStore.getState().pdfBytes).toEqual(new Uint8Array([1]));
    expect(useCompileStore.getState().lastCompiledAt).toBe(123);
    rejectCompile?.(new Error("stop"));
    await running;
  });

  it("keeps the last good PDF when compilation throws", async () => {
    mocks.compileProject.mockRejectedValue(new Error("compiler unavailable"));
    useCompileStore.setState({ pdfBytes: new Uint8Array([1]), lastCompiledAt: 123 });
    await useCompileStore.getState().recompile();
    expect(useCompileStore.getState().status).toBe("error");
    expect(useCompileStore.getState().pdfBytes).toEqual(new Uint8Array([1]));
    expect(useCompileStore.getState().lastCompiledAt).toBe(123);
  });

  it("normalizes unsupported Typst offline mode before IPC", async () => {
    mocks.files.mainDoc = "main.typ";
    mocks.files.engine = {
      ...LATEX_ENGINE,
      id: "typst",
      label: "Typst",
      source_format: "typst",
      main_document: "main.typ",
      source_extensions: ["typ"],
      capabilities: { ...LATEX_ENGINE.capabilities, supports_offline: false },
    };
    mocks.settings.offline = true;
    mocks.compileProject.mockResolvedValue({
      ok: false, has_pdf: false, log: "", errors: [], synctex_path: null,
      out_dir: null, compile_time_ms: 1,
    });
    await useCompileStore.getState().recompile();
    expect(mocks.compileProject).toHaveBeenCalledWith(
      "project",
      "main.typ",
      false,
      false,
      false,
    );
    expect(useCompileStore.getState().log).toContain("Typst does not expose an offline compiler mode");
  });

  it("stops safely when the Markdown Pandoc install flow is unavailable", async () => {
    mocks.files.mainDoc = "main.md";
    mocks.files.engine = {
      ...LATEX_ENGINE,
      id: "markdown",
      label: "Markdown / Pandoc",
      source_format: "markdown",
      main_document: "main.md",
      source_extensions: ["md", "markdown"],
      capabilities: { ...LATEX_ENGINE.capabilities, compiler_prerequisite: "pandoc", supports_offline: false, supports_synctex: false, supports_isolated_compile: false },
    };
    mocks.ensurePandoc.mockResolvedValue(false);
    await useCompileStore.getState().recompile();
    expect(mocks.ensurePandoc).toHaveBeenCalledExactlyOnceWith({ notify: true });
    expect(mocks.compileProject).not.toHaveBeenCalled();
    expect(useCompileStore.getState().status).toBe("unavailable");
    await useCompileStore.getState().recompile({ origin: "automatic" });
    expect(mocks.ensurePandoc).toHaveBeenLastCalledWith({ notify: false });
  });

  it("revalidates the captured project after awaiting Markdown installation", async () => {
    mocks.files.mainDoc = "main.md";
    mocks.files.engine = { ...LATEX_ENGINE, id: "markdown", label: "Markdown / Pandoc", source_format: "markdown", main_document: "main.md", source_extensions: ["md"], capabilities: { ...LATEX_ENGINE.capabilities, compiler_prerequisite: "pandoc" } };
    let finish: ((value: boolean) => void) | undefined;
    mocks.ensurePandoc.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve; }));
    const compiling = useCompileStore.getState().recompile();
    mocks.files.projectId = "another-project";
    finish?.(true);
    await compiling;
    expect(mocks.saveActive).not.toHaveBeenCalled();
    expect(mocks.compileProject).not.toHaveBeenCalled();
  });

  it("reports a nonzero compile as an error but still shows the best-effort PDF", async () => {
    const bestEffort = new Uint8Array([1]);
    mocks.compileProject.mockResolvedValue({
      ok: false,
      has_pdf: true,
      output_id: fingerprintCompileOutput(bestEffort),
      output_revision: null,
      log: "failed",
      errors: [],
      synctex_path: null,
      out_dir: "/build",
      compile_time_ms: 1,
    });
    mocks.readCompiledPdf.mockResolvedValue(bestEffort.buffer);
    useCompileStore.setState({ pdfBytes: new Uint8Array([9]), lastCompiledAt: 123 });
    await useCompileStore.getState().recompile();
    expect(useCompileStore.getState().status).toBe("error");
    expect(useCompileStore.getState().pdfBytes).toEqual(new Uint8Array([1]));
    expect(useCompileStore.getState().lastCompiledAt).toBe(123);
    expect(useCompileStore.getState().lastCompileCheckpoint).toBeNull();
    expect(mocks.notifyCompileSucceeded).not.toHaveBeenCalled();
    expect(mocks.readCompiledPdf).toHaveBeenCalledOnce();
  });

  it("rejects a successful result when the readable PDF belongs to another output", async () => {
    const compiled = new Uint8Array([1, 2, 3]);
    const overwritten = new Uint8Array([9, 9, 9]);
    mocks.compileProject.mockResolvedValue({
      ok: true,
      has_pdf: true,
      output_id: fingerprintCompileOutput(compiled),
      output_revision: 8,
      log: "ok",
      errors: [],
      synctex_path: null,
      out_dir: "/build",
      compile_time_ms: 1,
    });
    mocks.readCompiledPdf.mockResolvedValue(overwritten.buffer);
    useCompileStore.setState({
      pdfBytes: new Uint8Array([7]),
      lastCompiledAt: 123,
    });

    await useCompileStore.getState().recompile();

    const state = useCompileStore.getState();
    expect(state.status).toBe("error");
    expect(state.pdfBytes).toEqual(new Uint8Array([7]));
    expect(state.lastCompiledAt).toBe(123);
    expect(state.lastCompileCheckpoint).toBeNull();
    expect(state.log).toContain("changed before it could be verified");
    expect(mocks.notifyCompileSucceeded).not.toHaveBeenCalled();
  });

  it("does not let an older successful PDF read overwrite a newer remote checkpoint", async () => {
    const olderBytes = new Uint8Array([1, 2, 3]);
    const newerBytes = new Uint8Array([8, 8, 8]);
    const pendingRead = deferred<ArrayBuffer>();
    mocks.compileProject.mockResolvedValue({
      ok: true,
      has_pdf: true,
      output_id: fingerprintCompileOutput(olderBytes),
      output_revision: 7,
      log: "older local success",
      errors: [],
      synctex_path: null,
      out_dir: "/build",
      compile_time_ms: 1,
    });
    mocks.readCompiledPdf.mockReturnValue(pendingRead.promise);

    const compiling = useCompileStore.getState().recompile();
    await vi.waitFor(() => expect(mocks.readCompiledPdf).toHaveBeenCalledOnce());

    const newer = checkpoint(newerBytes, 8);
    useCompileStore.setState({
      status: "success",
      phase: "idle",
      pdfBytes: newerBytes,
      log: "newer remote success",
      lastCompiledAt: newer.completedAt,
      lastCompileCheckpoint: newer,
    });
    pendingRead.resolve(olderBytes.buffer);
    await compiling;

    expect(useCompileStore.getState()).toEqual(
      expect.objectContaining({
        status: "success",
        pdfBytes: newerBytes,
        log: "newer remote success",
        lastCompiledAt: newer.completedAt,
        lastCompileCheckpoint: newer,
      }),
    );
    expect(mocks.notifyCompileSucceeded).not.toHaveBeenCalled();
  });

  it("does not let a failed best-effort PDF read downgrade a newer remote success", async () => {
    const bestEffort = new Uint8Array([4, 5, 6]);
    const newerBytes = new Uint8Array([9, 9, 9]);
    const pendingRead = deferred<ArrayBuffer>();
    mocks.compileProject.mockResolvedValue({
      ok: false,
      has_pdf: true,
      output_id: fingerprintCompileOutput(bestEffort),
      output_revision: null,
      log: "older local failure",
      errors: [],
      synctex_path: null,
      out_dir: "/build",
      compile_time_ms: 1,
    });
    mocks.readCompiledPdf.mockReturnValue(pendingRead.promise);

    const compiling = useCompileStore.getState().recompile();
    await vi.waitFor(() => expect(mocks.readCompiledPdf).toHaveBeenCalledOnce());

    const newer = checkpoint(newerBytes, 9);
    useCompileStore.setState({
      status: "success",
      phase: "idle",
      pdfBytes: newerBytes,
      log: "newer remote success",
      lastCompiledAt: newer.completedAt,
      lastCompileCheckpoint: newer,
    });
    pendingRead.resolve(bestEffort.buffer);
    await compiling;

    expect(useCompileStore.getState()).toEqual(
      expect.objectContaining({
        status: "success",
        pdfBytes: newerBytes,
        log: "newer remote success",
        lastCompiledAt: newer.completedAt,
        lastCompileCheckpoint: newer,
      }),
    );
    expect(mocks.notifyCompileSucceeded).not.toHaveBeenCalled();
  });

  it("rejects a PDF read for a main document that is no longer active", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const priorBytes = new Uint8Array([7, 7, 7]);
    const pendingRead = deferred<ArrayBuffer>();
    mocks.compileProject.mockResolvedValue({
      ok: true,
      has_pdf: true,
      output_id: fingerprintCompileOutput(bytes),
      output_revision: 10,
      log: "success for old main",
      errors: [],
      synctex_path: null,
      out_dir: "/build",
      compile_time_ms: 1,
    });
    mocks.readCompiledPdf.mockReturnValue(pendingRead.promise);
    useCompileStore.setState({ pdfBytes: priorBytes });

    const compiling = useCompileStore.getState().recompile();
    await vi.waitFor(() => expect(mocks.readCompiledPdf).toHaveBeenCalledOnce());
    mocks.files.mainDoc = "replacement.tex";
    pendingRead.resolve(bytes.buffer);
    await compiling;

    expect(useCompileStore.getState()).toEqual(
      expect.objectContaining({
        status: "idle",
        phase: "idle",
        pdfBytes: priorBytes,
        lastCompileCheckpoint: null,
      }),
    );
    expect(mocks.notifyCompileSucceeded).not.toHaveBeenCalled();
  });

  it("preserves the prior PDF when the failed compile produced none at all", async () => {
    mocks.compileProject.mockResolvedValue({ ok: false, has_pdf: false, log: "failed", errors: [], synctex_path: null, out_dir: "/build", compile_time_ms: 1 });
    useCompileStore.setState({ pdfBytes: new Uint8Array([9]), lastCompiledAt: 123 });
    await useCompileStore.getState().recompile();
    expect(useCompileStore.getState().status).toBe("error");
    expect(useCompileStore.getState().pdfBytes).toEqual(new Uint8Array([9]));
    expect(useCompileStore.getState().lastCompiledAt).toBe(123);
    expect(mocks.readCompiledPdf).not.toHaveBeenCalled();
  });

  it("guards compile intent while Markdown installation is still pending", async () => {
    mocks.files.mainDoc = "main.md";
    mocks.files.engine = { ...LATEX_ENGINE, id: "markdown", label: "Markdown / Pandoc", source_format: "markdown", main_document: "main.md", source_extensions: ["md"], capabilities: { ...LATEX_ENGINE.capabilities, compiler_prerequisite: "pandoc" } };
    let finish: ((value: boolean) => void) | undefined;
    mocks.ensurePandoc.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve; }));
    const first = useCompileStore.getState().recompile();
    const second = await useCompileStore.getState().recompile();
    expect(second).toBeUndefined();
    expect(mocks.ensurePandoc).toHaveBeenCalledOnce();
    finish?.(false);
    await first;
    expect(mocks.compileProject).not.toHaveBeenCalled();
  });

  it("releases compile intent when Pandoc setup throws", async () => {
    mocks.files.mainDoc = "main.md";
    mocks.files.engine = { ...LATEX_ENGINE, id: "markdown", source_extensions: ["md"], capabilities: { ...LATEX_ENGINE.capabilities, compiler_prerequisite: "pandoc" } };
    mocks.ensurePandoc.mockRejectedValue(new Error("setup failed"));
    await useCompileStore.getState().recompile();
    expect(useCompileStore.getState().status).toBe("unavailable");
    expect(mocks.logError).toHaveBeenCalledWith("Pandoc setup", expect.any(Error));
    expect(mocks.notifyError).not.toHaveBeenCalled();
    mocks.ensurePandoc.mockResolvedValue(true);
    mocks.compileProject.mockResolvedValue({ ok: false, has_pdf: false, log: "", errors: [], synctex_path: null, out_dir: null, compile_time_ms: 1 });
    await useCompileStore.getState().recompile();
    expect(mocks.compileProject).toHaveBeenCalledOnce();
  });

  it("coalesces a second intent while save is pending", async () => {
    let finishSave: (() => void) | undefined;
    mocks.saveActive.mockReturnValue(new Promise<void>((resolve) => { finishSave = resolve; }));
    mocks.compileProject.mockResolvedValue({ ok: false, has_pdf: false, log: "", errors: [], synctex_path: null, out_dir: null, compile_time_ms: 1 });
    const first = useCompileStore.getState().recompile();
    await Promise.resolve();
    await useCompileStore.getState().recompile();
    expect(mocks.saveActive).toHaveBeenCalledOnce();
    finishSave?.();
    await first;
    await vi.waitFor(() => expect(mocks.compileProject).toHaveBeenCalledTimes(2));
  });

  it("does not invoke IPC when the project changes while save is pending", async () => {
    let finishSave: (() => void) | undefined;
    mocks.saveActive.mockReturnValue(new Promise<void>((resolve) => { finishSave = resolve; }));
    const compiling = useCompileStore.getState().recompile();
    mocks.files.projectId = "replacement";
    finishSave?.();
    await compiling;
    expect(mocks.compileProject).not.toHaveBeenCalled();
  });

  it("does not invoke IPC when the main document changes while save is pending", async () => {
    const pendingSave = deferred<void>();
    mocks.saveActive.mockReturnValue(pendingSave.promise);
    const compiling = useCompileStore.getState().recompile();
    mocks.files.mainDoc = "replacement.tex";
    pendingSave.resolve();
    await compiling;
    expect(mocks.compileProject).not.toHaveBeenCalled();
  });
});

describe("saving before a compile", () => {
  const failedResult = {
    ok: false,
    has_pdf: false,
    log: "",
    errors: [],
    synctex_path: null,
    out_dir: null,
    compile_time_ms: 1,
  };

  it("retries a write that lost a race with an outside edit once, silently", async () => {
    mocks.saveActive
      .mockRejectedValueOnce("mutation conflict at generation 42: the target changed after expectedGeneration")
      .mockResolvedValueOnce(undefined);
    mocks.compileProject.mockResolvedValue(failedResult);
    await useCompileStore.getState().recompile();
    expect(mocks.saveActive).toHaveBeenCalledTimes(2);
    expect(mocks.compileProject).toHaveBeenCalledOnce();
    expect(mocks.reportFileSaveFailure).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("reports a save that keeps failing through the shared autosave notice", async () => {
    const error = new Error("disk full");
    mocks.saveActive.mockRejectedValue(error);
    await useCompileStore.getState().recompile();
    await useCompileStore.getState().recompile({ origin: "automatic" });
    expect(mocks.saveActive).toHaveBeenCalledTimes(2);
    expect(mocks.compileProject).not.toHaveBeenCalled();
    expect(useCompileStore.getState().status).toBe("error");
    expect(useCompileStore.getState().failureReason).toContain("disk full");
    expect(mocks.reportFileSaveFailure).toHaveBeenNthCalledWith(
      1,
      "save before compile",
      "project",
      "main.tex",
      error,
      true,
    );
    expect(mocks.reportFileSaveFailure).toHaveBeenNthCalledWith(
      2,
      "save before compile",
      "project",
      "main.tex",
      error,
      false,
    );
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("retries only a mutation conflict and passes other failures on", async () => {
    const files = mocks.files as unknown as Parameters<typeof saveActiveForCompile>[0];
    mocks.saveActive.mockRejectedValueOnce(new Error("read-only folder"));
    await expect(saveActiveForCompile(files)).rejects.toThrow("read-only folder");
    expect(mocks.saveActive).toHaveBeenCalledOnce();
    mocks.saveActive
      .mockRejectedValueOnce("mutation conflict at generation 3")
      .mockRejectedValueOnce("mutation conflict at generation 4");
    await expect(saveActiveForCompile(files)).rejects.toBe("mutation conflict at generation 4");
    expect(mocks.saveActive).toHaveBeenCalledTimes(3);
  });

  it("logs a save failure when no file is active", async () => {
    const error = new Error("closed");
    mocks.files.activePath = null;
    mocks.saveActive.mockRejectedValue(error);
    await useCompileStore.getState().recompile();
    expect(mocks.reportFileSaveFailure).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith("save before compile", error);
  });
});

describe("restore from the on-disk compile fingerprint", () => {
  const pdfBytes = new TextEncoder().encode("%PDF-1.7 restored");
  const pdfBuffer = () => pdfBytes.buffer.slice(0) as ArrayBuffer;
  const validRecord = () => ({
    main_document: "main.tex",
    engine_id: "latex",
    output_id: fingerprintCompileOutput(pdfBytes),
    output_revision: 57,
    compiled_at_ms: 1_000,
    log: "Output written on main.pdf (2 pages).",
  });

  it("seeds the preview and checkpoint without compiling", async () => {
    mocks.validateCompileFingerprint.mockResolvedValue(validRecord());
    mocks.readCompiledPdf.mockResolvedValue(pdfBuffer());

    const restored = await useCompileStore.getState().restoreFromDisk("project", "main.tex");

    expect(restored).toBe(true);
    const state = useCompileStore.getState();
    expect(state.status).toBe("success");
    expect(state.pdfBytes).toEqual(pdfBytes);
    expect(state.lastCompileCheckpoint?.outputRevision).toBe(57);
    expect(state.lastCompileCheckpoint?.outputId).toBe(fingerprintCompileOutput(pdfBytes));
    // The logs pane must not come back empty after a restored open.
    expect(state.log).toBe("Output written on main.pdf (2 pages).");
    expect(mocks.compileProject).not.toHaveBeenCalled();
  });

  it("stays idle and reads no PDF when the fingerprint is invalid", async () => {
    mocks.validateCompileFingerprint.mockResolvedValue(null);

    const restored = await useCompileStore.getState().restoreFromDisk("project", "main.tex");

    expect(restored).toBe(false);
    expect(useCompileStore.getState().status).toBe("idle");
    expect(useCompileStore.getState().pdfBytes).toBeNull();
    expect(mocks.readCompiledPdf).not.toHaveBeenCalled();
  });

  it("rejects a PDF on disk that is not the fingerprinted output", async () => {
    mocks.validateCompileFingerprint.mockResolvedValue({
      ...validRecord(),
      output_id: "pdf-v1:9:deadbeefdeadbeef",
    });
    mocks.readCompiledPdf.mockResolvedValue(pdfBuffer());

    const restored = await useCompileStore.getState().restoreFromDisk("project", "main.tex");

    expect(restored).toBe(false);
    expect(useCompileStore.getState().status).toBe("idle");
    expect(useCompileStore.getState().pdfBytes).toBeNull();
  });

  it("never overwrites an existing checkpoint", async () => {
    useCompileStore.setState({
      lastCompileCheckpoint: {
        version: 1,
        projectId: "project",
        mainDocument: "main.tex",
        projectRevision: 0,
        requestGeneration: 0,
        outputKind: "standard",
        producerId: "latex",
        outputRevision: 3,
        outputId: "pdf-v1:1:aa",
        completedAt: 10,
      },
    });

    const restored = await useCompileStore.getState().restoreFromDisk("project", "main.tex");

    expect(restored).toBe(false);
    expect(mocks.validateCompileFingerprint).not.toHaveBeenCalled();
    expect(useCompileStore.getState().lastCompileCheckpoint?.outputRevision).toBe(3);
  });
});

describe("compile options", () => {
  const failedResult = {
    ok: false,
    has_pdf: false,
    log: "",
    errors: [],
    synctex_path: null,
    out_dir: null,
    compile_time_ms: 1,
  };

  it("forwards fast mode and stop-on-first-error to the compiler", async () => {
    mocks.compileProject.mockResolvedValue(failedResult);
    useCompileStore.setState({ compileMode: "fast", stopOnFirstError: true });

    await useCompileStore.getState().recompile();

    expect(mocks.compileProject).toHaveBeenCalledWith(
      "project",
      "main.tex",
      false,
      true,
      true,
    );
  });

  it("sends the active file's % !TEX root target to the compiler", async () => {
    mocks.compileProject.mockResolvedValue(failedResult);
    mocks.files.activePath = "chapters/ch1.tex";
    mocks.files.tree = [
      { path: "chapters/ch1.tex", is_dir: false },
      { path: "main.tex", is_dir: false },
      { path: "thesis.tex", is_dir: false },
    ];
    mocks.files.files = {
      ...mocks.files.files,
      "chapters/ch1.tex": {
        content: "% !TEX root = ../thesis.tex\n\\chapter{One}\n",
        dirty: false,
      },
    };

    await useCompileStore.getState().recompile();

    expect(mocks.compileProject).toHaveBeenCalledWith(
      "project",
      "thesis.tex",
      false,
      false,
      false,
    );
  });

  it("refuses to compile a main document the syntax check rejects", async () => {
    mocks.readFileContent.mockResolvedValue(
      "\\begin{document}\nunclosed\n",
    );
    mocks.compileProject.mockResolvedValue(failedResult);

    await useCompileStore.getState().recompile();

    expect(mocks.compileProject).not.toHaveBeenCalled();
    const state = useCompileStore.getState();
    expect(state.status).toBe("error");
    expect(state.errors.length).toBeGreaterThan(0);
    expect(state.errors[0].file).toBe("main.tex");
    expect(state.log).toContain("the compiler was not run");
  });

  it("compiles unchecked source when the syntax check is off", async () => {
    mocks.readFileContent.mockResolvedValue(
      "\\begin{document}\nunclosed\n",
    );
    mocks.compileProject.mockResolvedValue(failedResult);
    useCompileStore.setState({ checkSyntaxBeforeCompile: false });

    await useCompileStore.getState().recompile();

    expect(mocks.readFileContent).not.toHaveBeenCalled();
    expect(mocks.compileProject).toHaveBeenCalled();
  });

  it("lets the compiler report the problem when the check cannot read the source", async () => {
    mocks.readFileContent.mockRejectedValue(new Error("unreadable"));
    mocks.compileProject.mockResolvedValue(failedResult);

    await useCompileStore.getState().recompile();

    expect(mocks.compileProject).toHaveBeenCalled();
  });

  it("clears the build directory before a from-scratch compile", async () => {
    mocks.compileProject.mockResolvedValue(failedResult);

    await useCompileStore.getState().recompile({ fromScratch: true });

    expect(mocks.clearBuildDir).toHaveBeenCalledWith("project");
    expect(mocks.compileProject).toHaveBeenCalled();
  });

  it("leaves the build directory alone for an ordinary compile", async () => {
    mocks.compileProject.mockResolvedValue(failedResult);

    await useCompileStore.getState().recompile();

    expect(mocks.clearBuildDir).not.toHaveBeenCalled();
  });

  it("keeps the last good preview when the user stops a compile", async () => {
    const bytes = new Uint8Array([4, 5]);
    const stopped = checkpoint(bytes, 3);
    useCompileStore.setState({
      pdfBytes: bytes,
      lastCompileCheckpoint: stopped,
      lastCompiledAt: stopped.completedAt,
    });
    mocks.compileProject.mockResolvedValue({ ...failedResult, stopped: true });

    await useCompileStore.getState().recompile();

    const state = useCompileStore.getState();
    // A stop is not a failed document: no error, and the PDF stays on screen.
    expect(state.status).toBe("success");
    expect(state.failureReason).toBeNull();
    expect(state.pdfBytes).toEqual(bytes);
    expect(state.log).toContain("Compile stopped.");
  });

  it("asks the backend to end the running compile", async () => {
    await useCompileStore.getState().stopCompile();
    expect(mocks.cancelCompile).toHaveBeenCalledTimes(1);
  });

  it("reports a stop the user asked for when the backend refuses it", async () => {
    const error = new Error("no compiler");
    mocks.cancelCompile.mockRejectedValue(error);
    await useCompileStore.getState().stopCompile();
    expect(mocks.notifyError).toHaveBeenCalledWith("stop compile", error);
  });

  it("pauses a running compile for a TinyTeX install without a toast", async () => {
    const compile = deferred<typeof failedResult & { stopped: boolean }>();
    mocks.compileProject.mockReturnValue(compile.promise);
    const error = new Error("no compiler");
    mocks.cancelCompile.mockRejectedValue(error);
    const compiling = useCompileStore.getState().recompile();
    await vi.waitFor(() => expect(mocks.compileProject).toHaveBeenCalled());
    expect(stopRunningCompileQuietly()).toBe(true);
    expect(mocks.cancelCompile).toHaveBeenCalledOnce();
    compile.resolve({ ...failedResult, stopped: true });
    await compiling;
    await vi.waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("stop compile", error));
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(useCompileStore.getState().log).toContain("Compile stopped.");
  });

  it("leaves an idle compile alone when an install starts", () => {
    expect(stopRunningCompileQuietly()).toBe(false);
    expect(mocks.cancelCompile).not.toHaveBeenCalled();
  });
});

describe("compile log diagnostics", () => {
  const diagnostic: LogDiagnostic = {
    severity: "warning",
    category: "undefined-reference",
    file: "./main.tex",
    line: 10,
    message: "Cannot find reference `fig:x`.",
  };
  const failedResult: CompileResult = {
    ok: false,
    has_pdf: false,
    output_id: null,
    output_revision: null,
    log: "failed",
    errors: [],
    synctex_path: null,
    out_dir: null,
    compile_time_ms: 1,
  };

  it("resets diagnostics when a compile starts and stores the backend diagnostics from the result", async () => {
    useCompileStore.setState({ diagnostics: [diagnostic] });
    const compile = deferred<CompileResult>();
    mocks.compileProject.mockReturnValue(compile.promise);
    const compiling = useCompileStore.getState().recompile();
    await vi.waitFor(() => expect(mocks.compileProject).toHaveBeenCalled());
    expect(useCompileStore.getState().diagnostics).toBeNull();
    compile.resolve({ ...failedResult, diagnostics: [diagnostic] });
    await compiling;
    expect(useCompileStore.getState().status).toBe("error");
    expect(useCompileStore.getState().diagnostics).toEqual([diagnostic]);
  });

  it("leaves diagnostics unset when the backend result carries none", async () => {
    mocks.compileProject.mockResolvedValue(failedResult);
    await useCompileStore.getState().recompile();
    expect(useCompileStore.getState().status).toBe("error");
    expect(useCompileStore.getState().diagnostics).toBeNull();
  });

  it("clears diagnostics on reset", () => {
    useCompileStore.setState({ diagnostics: [diagnostic] });
    useCompileStore.getState().reset();
    expect(useCompileStore.getState().diagnostics).toBeNull();
  });
});

type ToastActionMock = { label: string; onClick: () => void };

function failedCompile(log: string): CompileResult {
  return {
    ok: false,
    has_pdf: false,
    output_id: null,
    output_revision: null,
    log,
    errors: [],
    synctex_path: null,
    out_dir: null,
    compile_time_ms: 1,
  };
}

function succeedNextCompile(revision: number): void {
  const bytes = new Uint8Array([revision, 1, 2]);
  mocks.compileProject.mockResolvedValue({
    ok: true,
    has_pdf: true,
    output_id: fingerprintCompileOutput(bytes),
    output_revision: revision,
    log: "Output written on main.pdf.",
    errors: [],
    synctex_path: null,
    out_dir: "/build",
    compile_time_ms: 1,
  });
  mocks.readCompiledPdf.mockResolvedValue(bytes.buffer.slice(0));
}

describe("missing TeX file installation", () => {
  let project = 0;
  const key = () => `missing-packages:${mocks.files.projectId}`;
  const offers = () => mocks.infoUnique.mock.calls.filter((call) => call[2] !== undefined);

  beforeEach(() => {
    mocks.files.projectId = `missing-packages-${++project}`;
    mocks.files.engine = { ...LATEX_ENGINE, id: "latexmk" };
    mocks.latexEngineInfo.mockReset().mockResolvedValue({ tlmgr: "/tex/tlmgr" });
    mocks.tlmgrInstallMissing.mockReset().mockResolvedValue("installed");
    mocks.refreshPackages.mockReset().mockResolvedValue(undefined);
    mocks.compileProject.mockResolvedValue(
      failedCompile("! LaTeX Error: File `tikz.sty' not found."),
    );
  });

  async function offer(): Promise<ToastActionMock> {
    await useCompileStore.getState().recompile();
    await vi.waitFor(() => expect(offers()).toHaveLength(1));
    return offers()[0][2] as ToastActionMock;
  }

  it("sends filenames to the resolver and recompiles only after installation", async () => {
    const action = await offer();
    expect(offers()[0][0]).toBe(key());
    expect(offers()[0][3]).toBe(true);
    const install = deferred<string>();
    mocks.tlmgrInstallMissing.mockReturnValue(install.promise);
    action.onClick();
    action.onClick();
    await vi.waitFor(() =>
      expect(mocks.tlmgrInstallMissing).toHaveBeenCalledExactlyOnceWith(["tikz.sty"]),
    );
    expect(mocks.infoUnique).toHaveBeenCalledTimes(2);
    expect(mocks.infoUnique).toHaveBeenLastCalledWith(
      key(),
      expect.stringContaining("tikz.sty"),
      undefined,
      true,
    );
    const installingId = mocks.infoUnique.mock.results[1].value;
    expect(mocks.compileProject).toHaveBeenCalledTimes(1);
    install.resolve("installed");
    await vi.waitFor(() => expect(mocks.compileProject).toHaveBeenCalledTimes(2));
    expect(mocks.dismiss).toHaveBeenCalledWith(installingId);
    expect(mocks.toastInfo).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("does not compile a different project after an installation finishes", async () => {
    const action = await offer();
    const install = deferred<string>();
    mocks.tlmgrInstallMissing.mockReturnValue(install.promise);
    action.onClick();
    mocks.files.projectId = "other-project";
    install.resolve("installed");
    await vi.waitFor(() => expect(mocks.refreshPackages).toHaveBeenCalled());
    await vi.dynamicImportSettled();
    expect(mocks.compileProject).toHaveBeenCalledTimes(1);
  });

  it("reports a failed install in the same notice and offers the set again on the next compile", async () => {
    const action = await offer();
    mocks.tlmgrInstallMissing.mockRejectedValueOnce(
      "TeX Live has no package that provides tikz.sty.",
    );
    action.onClick();
    await vi.waitFor(() => expect(mocks.errorUnique).toHaveBeenCalledOnce());
    const [errorKey, message] = mocks.errorUnique.mock.calls[0];
    expect(errorKey).toBe(key());
    expect(message).toContain("tikz.sty");
    expect(message).toContain("TeX Live has no package");
    expect(mocks.logError).toHaveBeenCalledWith(
      "install missing packages",
      "TeX Live has no package that provides tikz.sty.",
    );
    await useCompileStore.getState().recompile();
    await vi.waitFor(() => expect(offers()).toHaveLength(2));
    expect(offers()[1][0]).toBe(key());
    await useCompileStore.getState().recompile();
    await vi.dynamicImportSettled();
    expect(offers()).toHaveLength(2);
    expect(mocks.tlmgrInstallMissing).toHaveBeenCalledTimes(1);
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("keeps an automatic compile quiet and leaves the install in the preview", async () => {
    await useCompileStore.getState().recompile({ origin: "automatic" });
    await vi.waitFor(() =>
      expect(useCompileStore.getState().offer).toEqual({
        kind: "missing-packages",
        projectId: mocks.files.projectId,
        packages: ["tikz.sty"],
      }),
    );
    expect(mocks.infoUnique).not.toHaveBeenCalled();
    expect(mocks.errorUnique).not.toHaveBeenCalled();

    const offered = useCompileStore.getState().offer;
    if (!offered) throw new Error("expected a compile offer");
    acceptCompileOffer(offered);
    expect(useCompileStore.getState().offer).toBeNull();
    await vi.waitFor(() =>
      expect(mocks.tlmgrInstallMissing).toHaveBeenCalledExactlyOnceWith(["tikz.sty"]),
    );
  });

  it("points at the distribution gap instead of offering a one-by-one install", async () => {
    mocks.texDistributionGapNotice.mockReturnValue("Pinned with TeX Live, missing 900 packages.");
    await useCompileStore.getState().recompile();
    await vi.dynamicImportSettled();
    expect(mocks.infoUnique).toHaveBeenCalledExactlyOnceWith(
      key(),
      "Pinned with TeX Live, missing 900 packages.",
    );
    expect(offers()).toHaveLength(0);

    mocks.infoUnique.mockClear();
    await useCompileStore.getState().recompile({ origin: "automatic" });
    await vi.dynamicImportSettled();
    expect(mocks.infoUnique).not.toHaveBeenCalled();
  });

  it("ignores an install action once another project is open", async () => {
    const action = await offer();
    mocks.files.projectId = "another-project";
    action.onClick();
    expect(mocks.tlmgrInstallMissing).not.toHaveBeenCalled();
  });

  it("offers each set of missing files once, however often the compile repeats", async () => {
    await offer();
    for (let attempt = 0; attempt < 5; attempt++) {
      await useCompileStore.getState().recompile();
    }
    await vi.dynamicImportSettled();
    expect(offers()).toHaveLength(1);
    mocks.compileProject.mockResolvedValue(
      failedCompile("! LaTeX Error: File `pgfplots.sty' not found."),
    );
    await useCompileStore.getState().recompile();
    await vi.waitFor(() => expect(offers()).toHaveLength(2));
    expect(offers()[1][0]).toBe(key());
    expect(offers()[1][1]).toContain("pgfplots.sty");
  });

  it("folds the personal tree notice into the same notice", async () => {
    const action = await offer();
    succeedNextCompile(11);
    mocks.tlmgrInstallMissing.mockResolvedValue(
      "[Oleafly] The system TeX tree is not writable, so the packages went into your personal tree at /home/u/texmf.\ntlmgr: installing pgf",
    );
    action.onClick();
    await vi.waitFor(() => expect(mocks.compileProject).toHaveBeenCalledTimes(2));
    expect(mocks.infoUnique).toHaveBeenCalledTimes(3);
    const final = mocks.infoUnique.mock.calls[2];
    expect(final[0]).toBe(key());
    expect(final[1]).toContain("/home/u/texmf");
    expect(final[2]).toBeUndefined();
    expect(final[3]).toBeUndefined();
    expect(mocks.dismiss).not.toHaveBeenCalled();
    expect(mocks.toastInfo).not.toHaveBeenCalled();
    expect(mocks.logError).not.toHaveBeenCalledWith(
      "install missing packages",
      expect.stringContaining("personal tree"),
    );
  });

  it("clears the offer after the next successful compile", async () => {
    await offer();
    const offerId = mocks.infoUnique.mock.results[0].value;
    succeedNextCompile(7);
    await useCompileStore.getState().recompile();
    expect(useCompileStore.getState().status).toBe("success");
    expect(mocks.dismiss).toHaveBeenCalledWith(offerId);
  });

  it("reads only Oleafly notices out of the installer output", () => {
    expect(installerNotices("tlmgr: installing pgf\nrunning mktexlsr")).toEqual([]);
    expect(
      installerNotices("[Oleafly] Packages went to the user tree.\ntlmgr: done"),
    ).toEqual(["Packages went to the user tree."]);
    expect(installerNotices(`[Oleafly] ${"x".repeat(500)}`)).toEqual([]);
  });
});

describe("bundled-engine compile failures", () => {
  let project = 0;
  const bundleFailure = [
    "error: this bundle isn't cached, and we couldn't get it from the internet",
    "caused by: unexpected HTTP response code 503 for URL https://mirrors.oleafly.com/tex-bundles/tlextras-2022.0r0.tar",
    "! LaTeX Error: File `amsmath.sty' not found.",
  ].join("\n");

  beforeEach(() => {
    mocks.files.projectId = `bundled-engine-${++project}`;
    mocks.files.engine = LATEX_ENGINE;
    mocks.latexEngineInfo.mockReset().mockResolvedValue({ tlmgr: "/tex/tlmgr" });
    useEnginePickerStore.setState({ open: false, source: "manual", findings: [] });
  });

  function failWith(log: string) {
    mocks.compileProject.mockResolvedValue(failedCompile(log));
  }

  it("opens the engine picker for a Tectonic template failure the user compiled", async () => {
    failWith(
      [
        "! Package hyperref Error: Wrong driver option `pdftex',",
        'error: pdf: image inclusion failed for "images/MDHlogga.eps"',
      ].join("\n"),
    );
    await useCompileStore.getState().recompile();
    const picker = useEnginePickerStore.getState();
    expect(picker.open).toBe(true);
    expect(picker.source).toBe("compile-failure");
    expect(picker.findings.map((f) => f.id)).toEqual([
      "hyperref-pdftex-driver",
      "eps-image",
    ]);
    expect(useCompileStore.getState().offer).toMatchObject({ kind: "engine-gap" });
    expect(mocks.infoUnique).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.errorUnique).not.toHaveBeenCalled();
  });

  it("keeps an automatic compile quiet and leaves the engine choice in the preview", async () => {
    failWith(
      [
        "! Package hyperref Error: Wrong driver option `pdftex',",
        'error: pdf: image inclusion failed for "images/MDHlogga.eps"',
      ].join("\n"),
    );
    await useCompileStore.getState().recompile({ origin: "automatic" });
    await useCompileStore.getState().recompile({ origin: "automatic" });
    expect(useEnginePickerStore.getState().open).toBe(false);
    expect(mocks.infoUnique).not.toHaveBeenCalled();
    expect(mocks.errorUnique).not.toHaveBeenCalled();
    const offered = useCompileStore.getState().offer;
    expect(offered).toMatchObject({ kind: "engine-gap", projectId: mocks.files.projectId });
    if (!offered) throw new Error("expected a compile offer");

    acceptCompileOffer(offered);
    const picker = useEnginePickerStore.getState();
    expect(picker.open).toBe(true);
    expect(picker.source).toBe("compile-failure");
    expect(picker.findings.map((f) => f.id)).toEqual([
      "hyperref-pdftex-driver",
      "eps-image",
    ]);
  });

  it("falls back to the findings of the open scan when the log names no known gap", async () => {
    const minted = importCompatFinding("minted");
    mocks.projectCompatibilityFindings.mockReturnValue([minted]);
    failWith("! Undefined control sequence.");
    await useCompileStore.getState().recompile();
    expect(mocks.projectCompatibilityFindings).toHaveBeenCalledWith(mocks.files.projectId);
    expect(useEnginePickerStore.getState().findings.map((f) => f.id)).toEqual(["minted"]);
  });

  it("offers the engine choice for a known gap even when the package download failed", async () => {
    const minted = importCompatFinding("minted");
    mocks.projectCompatibilityFindings.mockReturnValue([minted]);
    failWith(bundleFailure);
    await useCompileStore.getState().recompile({ origin: "automatic" });
    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(useCompileStore.getState().offer).toMatchObject({
      kind: "engine-gap",
      projectId: mocks.files.projectId,
      findings: [expect.objectContaining({ id: "minted" })],
    });
    await useCompileStore.getState().recompile();
    expect(mocks.errorUnique).not.toHaveBeenCalled();
    const picker = useEnginePickerStore.getState();
    expect(picker.open).toBe(true);
    expect(picker.findings.map((f) => f.id)).toEqual(["minted"]);
  });

  it("clears the offer when the next compile starts", async () => {
    failWith("! LaTeX Error: File `thesisMDU.cls' not found.");
    await useCompileStore.getState().recompile({ origin: "automatic" });
    expect(useCompileStore.getState().offer).not.toBeNull();
    succeedNextCompile(12);
    await useCompileStore.getState().recompile({ origin: "automatic" });
    expect(useCompileStore.getState().status).toBe("success");
    expect(useCompileStore.getState().offer).toBeNull();
  });

  it("answers a failed bundle download the user compiled, and stays quiet for automatic compiles", async () => {
    failWith(bundleFailure);
    await useCompileStore.getState().recompile();
    expect(useEnginePickerStore.getState().open).toBe(false);
    expect(mocks.errorUnique).toHaveBeenCalledOnce();
    const [key, message, action, sticky] = mocks.errorUnique.mock.calls[0];
    expect(key).toBe(`compile-retry:${mocks.files.projectId}`);
    expect(sticky).toBe(true);
    expect(message).not.toContain("HTTP 503");
    expect(message).toContain("Check your connection");
    expect((action as ToastActionMock).label).toBe("Compile again");
    expect(useCompileStore.getState().failureReason).toBe(message);
    await useCompileStore.getState().recompile({ origin: "automatic" });
    await useCompileStore.getState().recompile({ origin: "automatic" });
    expect(mocks.errorUnique).toHaveBeenCalledOnce();
    expect(useCompileStore.getState().failureReason).toBe(message);
    expect(mocks.infoUnique).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    (action as ToastActionMock).onClick();
    await vi.waitFor(() => expect(mocks.errorUnique).toHaveBeenCalledTimes(2));
    expect(mocks.compileProject).toHaveBeenCalledTimes(4);
    expect(mocks.errorUnique.mock.calls[1][0]).toBe(key);
  });

  it("retries once when the connection returns and clears the notice after a success", async () => {
    vi.stubGlobal("window", new EventTarget());
    try {
      failWith(bundleFailure);
      await useCompileStore.getState().recompile();
      const noticeId = mocks.errorUnique.mock.results[0].value;
      succeedNextCompile(9);
      globalThis.window.dispatchEvent(new Event("online"));
      await vi.waitFor(() => expect(useCompileStore.getState().status).toBe("success"));
      expect(mocks.compileProject).toHaveBeenCalledTimes(2);
      expect(mocks.dismiss).toHaveBeenCalledWith(noticeId);
      globalThis.window.dispatchEvent(new Event("online"));
      await vi.dynamicImportSettled();
      expect(mocks.compileProject).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("runs the missing-package offer on the first failure after the switch to latexmk", async () => {
    failWith("! LaTeX Error: File `thesisMDU.cls' not found.");
    await useCompileStore.getState().recompile();
    expect(mocks.infoUnique).not.toHaveBeenCalled();
    expect(useEnginePickerStore.getState().open).toBe(true);
    expect(useEnginePickerStore.getState().findings.map((f) => f.id)).toContain(
      "missing-sty-on-bundled-engine",
    );

    mocks.files.engine = { ...LATEX_ENGINE, id: "latexmk" };
    mocks.tlmgrInstallMissing.mockReset().mockResolvedValue("installed");
    await useCompileStore.getState().recompile();
    await vi.waitFor(() =>
      expect(
        mocks.infoUnique.mock.calls.some(
          (call) =>
            call[0] === `missing-packages:${mocks.files.projectId}` &&
            String(call[1]).includes("thesisMDU.cls"),
        ),
      ).toBe(true),
    );
  });
});
