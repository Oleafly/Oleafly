import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { CompileResult, DocumentEngineDescriptor } from "@oleafly/backend-port";

const TYPST_ENGINE: DocumentEngineDescriptor = {
  ...LATEX_ENGINE,
  id: "typst",
  label: "Typst",
  source_format: "typst",
  main_document: "main.typ",
  source_extensions: ["typ"],
  capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "typst" },
  typst_version: null,
  typst_resolved: { version: "0.15.1", source: "bundled" },
  typst_missing: null,
};

const mocks = vi.hoisted(() => ({
  compileProject: vi.fn(),
  readCompiledPdf: vi.fn(),
  compileLive: vi.fn(),
  syncLivePreview: vi.fn(async () => {}),
  stopLivePreview: vi.fn(async () => {}),
  interruptLivePreview: vi.fn(async () => {}),
  cancelCompile: vi.fn(async () => true),
  refreshPreviewWindow: vi.fn(),
  notifyCompileSucceeded: vi.fn(),
  logError: vi.fn(),
  saveActive: vi.fn(async () => {}),
  files: {
    projectId: "project" as string | null,
    activePath: "main.typ" as string | null,
    mainDoc: "main.typ",
    mainDecision: "auto",
    engine: null as unknown,
    engineLoaded: true,
    engineError: null,
    loading: false,
    tree: [{ path: "main.typ", is_dir: false }],
    files: { "main.typ": { content: "= Hello", dirty: false } } as Record<string, { content: string; dirty: boolean }>,
    saveActive: vi.fn(async () => {}),
  },
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  withEventListener: (await importOriginal<typeof import("@/lib/tauri")>()).withEventListener,
  compileProject: mocks.compileProject,
  readCompiledPdf: mocks.readCompiledPdf,
  validateCompileFingerprint: vi.fn(async () => null),
  readFileContent: vi.fn(async () => "= Hello"),
  cancelCompile: mocks.cancelCompile,
  clearBuildDir: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@/features/typst-live-preview", () => ({
  compileLive: mocks.compileLive,
  syncLivePreview: mocks.syncLivePreview,
  stopLivePreview: mocks.stopLivePreview,
  interruptLivePreview: mocks.interruptLivePreview,
}));
vi.mock("@/store/files", () => ({
  engineErrorMessage: (reason: string) => reason,
  engineSwitchToastKey: (projectId: string) => `engine-switch:${projectId}`,
  projectCompatibilityFindings: () => [],
  reportFileSaveFailure: vi.fn(),
  texDistributionGapNotice: () => null,
  useFilesStore: { getState: () => mocks.files, subscribe: () => () => {} },
}));
vi.mock("@/store/project-index", () => ({
  currentProjectSourcePaths: () => ["main.typ"],
  projectFilesystemEpoch: () => 0,
  readProjectSources: vi.fn(async (_projectId: string, paths: readonly string[]) => ({
    texts: Object.fromEntries(paths.map((path) => [path, mocks.files.files[path]?.content ?? ""])),
    unreadable: new Set<string>(),
  })),
  useIndexStore: { getState: () => ({ texts: {} }) },
}));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: () => ({ offline: false, typstFormatOnSave: false }) } }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/preview-window", () => ({ refreshPreviewWindow: mocks.refreshPreviewWindow }));
vi.mock("@/lib/cross-window", () => ({
  currentCompileProducerId: () => "test-window",
  notifyCompileSucceeded: mocks.notifyCompileSucceeded,
}));

import { fingerprintCompileOutput } from "@/lib/compile-checkpoint";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import {
  applyTypstLiveResult,
  syncTypstLivePreview,
  typstLivePreviewWanted,
  useCompileStore,
} from "./compile";

function success(bytes: Uint8Array, revision: number): CompileResult {
  return {
    ok: true,
    has_pdf: true,
    output_id: fingerprintCompileOutput(bytes),
    output_revision: revision,
    log: "[12:00:00] compiled successfully in 5 ms\n",
    errors: [],
    diagnostics: [],
    synctex_path: null,
    out_dir: null,
    compile_time_ms: 5,
  };
}

function failure(): CompileResult {
  return {
    ok: false,
    has_pdf: false,
    output_id: null,
    output_revision: null,
    log: "[12:00:01] compiled with errors\n\nerror: unknown variable: x\n",
    errors: [{ line: 2, file: "main.typ", message: "unknown variable: x", kind: "error", explanation: null }],
    diagnostics: [],
    synctex_path: null,
    out_dir: null,
    compile_time_ms: 0,
  };
}

beforeEach(() => {
  localStorage.clear();
  mocks.files.projectId = "project";
  mocks.files.engine = TYPST_ENGINE;
  mocks.files.engineLoaded = true;
  mocks.files.mainDoc = "main.typ";
  mocks.files.saveActive = mocks.saveActive;
  mocks.compileProject.mockReset();
  mocks.compileLive.mockReset();
  mocks.readCompiledPdf.mockReset();
  mocks.syncLivePreview.mockClear();
  mocks.stopLivePreview.mockClear();
  mocks.interruptLivePreview.mockClear();
  mocks.cancelCompile.mockClear();
  useProjectAnalysisStore.getState().reset();
  useProjectAnalysisStore.getState().activateProject({
    projectId: "project",
    projectRevision: 3,
    languageServiceGeneration: 0,
  });
  useCompileStore.getState().reset();
  useCompileStore.setState({
    autoCompile: false,
    checkSyntaxBeforeCompile: false,
    livePreview: { projectId: null, enabled: false, status: "off", message: null },
  });
});

function autoCompileOn() {
  useCompileStore.getState().setAutoCompile(true);
}

describe("Typst live preview in the compile store", () => {
  it("drives a Typst project through the watcher while auto compile is on", async () => {
    expect(typstLivePreviewWanted()).toBe(false);
    autoCompileOn();
    expect(typstLivePreviewWanted()).toBe(true);
    expect(useCompileStore.getState().livePreview).toEqual({
      projectId: "project",
      enabled: true,
      status: "starting",
      message: null,
    });
    await vi.waitFor(() => expect(mocks.syncLivePreview).toHaveBeenCalled());

    useCompileStore.getState().setAutoCompile(false);
    expect(typstLivePreviewWanted()).toBe(false);
    expect(useCompileStore.getState().livePreview).toMatchObject({ projectId: "project", enabled: false, status: "off" });
    await vi.waitFor(() => expect(mocks.syncLivePreview).toHaveBeenCalledTimes(2));
  });

  it("is never wanted for a LaTeX project or a missing Typst version", () => {
    autoCompileOn();
    mocks.files.engine = LATEX_ENGINE;
    expect(typstLivePreviewWanted()).toBe(false);
    mocks.files.engine = { ...TYPST_ENGINE, typst_missing: "0.13.1" };
    expect(typstLivePreviewWanted()).toBe(false);
  });

  it("drops the old per-project live preview flags and follows auto compile alone", () => {
    localStorage.setItem("oleafly:compile:typst-live:project", "1");
    localStorage.setItem("oleafly:compile:typst-live:other", "1");
    localStorage.setItem("oleafly:compile:mode", "fast");
    syncTypstLivePreview();
    expect(useCompileStore.getState().livePreview).toMatchObject({ projectId: "project", enabled: false, status: "off" });
    expect(localStorage.getItem("oleafly:compile:typst-live:project")).toBeNull();
    expect(localStorage.getItem("oleafly:compile:typst-live:other")).toBeNull();
    expect(localStorage.getItem("oleafly:compile:mode")).toBe("fast");
  });

  it("stops a running watch cycle along with the compiler", async () => {
    autoCompileOn();
    await vi.waitFor(() => expect(mocks.syncLivePreview).toHaveBeenCalled());
    await useCompileStore.getState().stopCompile();
    expect(mocks.cancelCompile).toHaveBeenCalledOnce();
    expect(mocks.interruptLivePreview).toHaveBeenCalledOnce();
  });

  it("compiles through the watcher while auto compile drives a Typst project", async () => {
    autoCompileOn();
    const bytes = new Uint8Array([1, 2, 3]);
    mocks.compileLive.mockResolvedValue(success(bytes, 11));
    mocks.readCompiledPdf.mockResolvedValue(bytes.buffer);
    await useCompileStore.getState().recompile();
    expect(mocks.compileProject).not.toHaveBeenCalled();
    expect(mocks.compileLive).toHaveBeenCalledWith({
      projectId: "project",
      mainDoc: "main.typ",
      offline: false,
      typstVariant: null,
      fresh: true,
    });
    expect(useCompileStore.getState().status).toBe("success");
    expect(useCompileStore.getState().lastCompileCheckpoint?.outputRevision).toBe(11);

    await useCompileStore.getState().recompile({ origin: "automatic" });
    expect(mocks.compileLive).toHaveBeenLastCalledWith(expect.objectContaining({ fresh: false }));
  });

  it("uses the normal compiler when the watcher gave up", async () => {
    autoCompileOn();
    useCompileStore.getState().setLivePreviewStatus("project", "failed", "crashed");
    mocks.compileProject.mockResolvedValue(failure());
    await useCompileStore.getState().recompile();
    expect(mocks.compileLive).not.toHaveBeenCalled();
    expect(mocks.compileProject).toHaveBeenCalled();
  });

  it("settles an attempt whose answer is the output already on screen", async () => {
    autoCompileOn();
    const bytes = new Uint8Array([4, 5, 6]);
    mocks.readCompiledPdf.mockResolvedValue(bytes.buffer);
    await applyTypstLiveResult({
      projectId: "project",
      mainDocument: "main.typ",
      projectRevision: 3,
      result: success(bytes, 20),
    });
    expect(useCompileStore.getState().lastCompileCheckpoint?.outputRevision).toBe(20);
    mocks.readCompiledPdf.mockClear();
    mocks.compileLive.mockResolvedValue(success(bytes, 20));
    await useCompileStore.getState().recompile({ origin: "automatic" });
    expect(useCompileStore.getState().status).toBe("success");
    expect(mocks.readCompiledPdf).not.toHaveBeenCalled();
  });

  it("applies live results like a compile and keeps the preview on errors", async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    mocks.readCompiledPdf.mockResolvedValue(bytes.buffer);
    expect(
      await applyTypstLiveResult({
        projectId: "project",
        mainDocument: "main.typ",
        projectRevision: 3,
        result: success(bytes, 30),
      }),
    ).toBe(true);
    const state = useCompileStore.getState();
    expect(state.status).toBe("success");
    expect(state.pdfBytes).toEqual(bytes);
    expect(state.lastCompileCheckpoint).toMatchObject({ projectRevision: 3, outputRevision: 30 });
    expect(mocks.notifyCompileSucceeded).toHaveBeenCalled();

    await applyTypstLiveResult({
      projectId: "project",
      mainDocument: "main.typ",
      projectRevision: 4,
      result: failure(),
    });
    const failed = useCompileStore.getState();
    expect(failed.status).toBe("error");
    expect(failed.errors[0].message).toBe("unknown variable: x");
    expect(failed.pdfBytes).toEqual(bytes);
    expect(failed.lastCompileCheckpoint?.outputRevision).toBe(30);
  });

  it("drops live results for another project or main document", async () => {
    const bytes = new Uint8Array([1]);
    mocks.readCompiledPdf.mockResolvedValue(bytes.buffer);
    expect(
      await applyTypstLiveResult({
        projectId: "other",
        mainDocument: "main.typ",
        projectRevision: 3,
        result: success(bytes, 40),
      }),
    ).toBe(false);
    expect(
      await applyTypstLiveResult({
        projectId: "project",
        mainDocument: "chapter.typ",
        projectRevision: 3,
        result: success(bytes, 41),
      }),
    ).toBe(false);
    expect(useCompileStore.getState().lastCompileCheckpoint).toBeNull();
  });

  it("keeps the newest output when an older live result arrives late", async () => {
    const newer = new Uint8Array([2]);
    mocks.readCompiledPdf.mockResolvedValue(newer.buffer);
    await applyTypstLiveResult({ projectId: "project", mainDocument: "main.typ", projectRevision: 3, result: success(newer, 50) });
    const older = new Uint8Array([1]);
    mocks.readCompiledPdf.mockResolvedValue(older.buffer);
    await applyTypstLiveResult({ projectId: "project", mainDocument: "main.typ", projectRevision: 3, result: success(older, 49) });
    expect(useCompileStore.getState().lastCompileCheckpoint?.outputRevision).toBe(50);
    expect(useCompileStore.getState().pdfBytes).toEqual(newer);
  });
});
