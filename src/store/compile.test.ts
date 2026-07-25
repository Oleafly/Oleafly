import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  compileProject: vi.fn(),
  readCompiledPdf: vi.fn(),
  notifyCompileSucceeded: vi.fn(),
  refreshPreviewWindow: vi.fn(),
  ensurePandoc: vi.fn(),
  saveActive: vi.fn(),
  settings: { offline: false },
  files: {
    projectId: "project" as string | null,
    mainDoc: "main.tex",
    engine: null as unknown,
    engineLoaded: true,
    engineError: null as string | null,
    saveActive: vi.fn(),
  },
}));

vi.mock("@/lib/tauri", () => ({
  compileProject: mocks.compileProject,
  readCompiledPdf: mocks.readCompiledPdf,
}));
vi.mock("@/features/pandoc", () => ({ ensurePandoc: mocks.ensurePandoc }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.files } }));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: () => mocks.settings } }));
vi.mock("@/lib/toast", () => ({ notifyError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/preview-window", () => ({
  refreshPreviewWindow: mocks.refreshPreviewWindow,
}));
vi.mock("@/lib/cross-window", () => ({
  currentCompileProducerId: () => "test-window",
  notifyCompileSucceeded: mocks.notifyCompileSucceeded,
}));

import { useCompileStore } from "./compile";
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

beforeEach(() => {
  mocks.compileProject.mockReset();
  mocks.readCompiledPdf.mockReset();
  mocks.notifyCompileSucceeded.mockReset();
  mocks.refreshPreviewWindow.mockReset();
  mocks.ensurePandoc.mockReset().mockResolvedValue(true);
  mocks.saveActive.mockReset().mockResolvedValue(undefined);
  mocks.files.saveActive = mocks.saveActive;
  mocks.files.projectId = "project";
  mocks.files.mainDoc = "main.tex";
  mocks.files.engine = LATEX_ENGINE;
  mocks.files.engineLoaded = true;
  mocks.files.engineError = null;
  mocks.settings.offline = false;
  useCompileStore.getState().reset();
});

describe("compile output lifecycle", () => {
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

  it("releases intent when the engine is unloaded so a loaded retry can compile", async () => {
    mocks.files.engineLoaded = false;
    await useCompileStore.getState().recompile();
    mocks.files.engineLoaded = true;
    mocks.compileProject.mockResolvedValue({ ok: false, has_pdf: false, log: "", errors: [], synctex_path: null, out_dir: null, compile_time_ms: 1 });
    await useCompileStore.getState().recompile();
    expect(mocks.compileProject).toHaveBeenCalledOnce();
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
    expect(mocks.compileProject).toHaveBeenCalledWith("project", "main.typ", false);
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
    expect(mocks.ensurePandoc).toHaveBeenCalledOnce();
    expect(mocks.compileProject).not.toHaveBeenCalled();
    expect(useCompileStore.getState().status).toBe("idle");
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
