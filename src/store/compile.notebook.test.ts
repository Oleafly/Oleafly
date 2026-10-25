import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { CompileResult, DocumentEngineDescriptor } from "@oleafly/backend-port";
import type { NotebookToolchainStatus, NotebookToolStatus } from "@/lib/notebook-commands";

function notebookEngine(id: "quarto" | "calepin"): DocumentEngineDescriptor {
  return {
    ...LATEX_ENGINE,
    id,
    label: id === "quarto" ? "Quarto" : "Calepin",
    source_format: id === "quarto" ? "markdown" : "typst",
    main_document: id === "quarto" ? "report.qmd" : "report.typ",
    source_extensions: id === "quarto" ? ["qmd", "rmd"] : ["typ"],
    capabilities: {
      ...LATEX_ENGINE.capabilities,
      formatting_profile: id === "quarto" ? "markdown" : "typst",
      supports_synctex: false,
      supports_offline: false,
      compiler_prerequisite: id,
    },
    allow_shell_escape: false,
  } as unknown as DocumentEngineDescriptor;
}

const mocks = vi.hoisted(() => ({
  compileProject: vi.fn(),
  readCompiledPdf: vi.fn(),
  refreshPreviewWindow: vi.fn(),
  notifyCompileSucceeded: vi.fn(),
  logError: vi.fn(),
  notebookToolchainStatus: vi.fn(),
  installNotebookTool: vi.fn(),
  settings: {
    offline: false,
    typstFormatOnSave: false,
    setSettingsInitialSection: vi.fn(),
    setSettingsScrollTarget: vi.fn(),
    setSettingsOpen: vi.fn(),
  },
  files: {
    projectId: "project" as string | null,
    activePath: "report.qmd" as string | null,
    mainDoc: "report.qmd",
    mainDecision: "auto",
    engine: null as unknown,
    engineLoaded: true,
    engineError: null,
    loading: false,
    tree: [{ path: "report.qmd", is_dir: false }],
    files: { "report.qmd": { content: "# Hello", dirty: false } } as Record<string, { content: string; dirty: boolean }>,
    saveAllDirty: vi.fn(async () => {}),
  },
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  withEventListener: (await importOriginal<typeof import("@/lib/tauri")>()).withEventListener,
  compileProject: mocks.compileProject,
  readCompiledPdf: mocks.readCompiledPdf,
  validateCompileFingerprint: vi.fn(async () => null),
  readFileContent: vi.fn(async () => "# Hello"),
  cancelCompile: vi.fn(async () => true),
  clearBuildDir: vi.fn(async () => {}),
}));
vi.mock("@/lib/notebook-commands", () => ({
  notebookToolchainStatus: mocks.notebookToolchainStatus,
  installNotebookTool: mocks.installNotebookTool,
  removeNotebookTool: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@/store/files", () => ({
  engineErrorMessage: (reason: string) => reason,
  engineSwitchToastKey: (projectId: string) => `engine-switch:${projectId}`,
  projectCompatibilityFindings: () => [],
  reportFileSaveFailure: vi.fn(),
  texDistributionGapNotice: () => null,
  useFilesStore: { getState: () => mocks.files, subscribe: () => () => {} },
}));
vi.mock("@/store/project-index", () => ({
  currentProjectSourcePaths: () => [mocks.files.mainDoc],
  projectFilesystemEpoch: () => 0,
  readProjectSources: vi.fn(async (_projectId: string, paths: readonly string[]) => ({
    texts: Object.fromEntries(paths.map((path) => [path, mocks.files.files[path]?.content ?? ""])),
    unreadable: new Set<string>(),
  })),
  useIndexStore: { getState: () => ({ texts: {} }) },
}));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: () => mocks.settings } }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/preview-window", () => ({ refreshPreviewWindow: mocks.refreshPreviewWindow }));
vi.mock("@/lib/cross-window", () => ({
  currentCompileProducerId: () => "test-window",
  notifyCompileSucceeded: mocks.notifyCompileSucceeded,
}));

import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import { APP_ERROR_PREFIX } from "@/lib/app-error";
import { fingerprintCompileOutput } from "@/lib/compile-checkpoint";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { QUARTO_SETTINGS_TARGET, useNotebookToolchainStore } from "@/store/notebook-toolchain";
import { acceptCompileOffer, installMissingNotebookTool, useCompileStore } from "./compile";

function toolStatus(name: "quarto" | "calepin", installed: boolean): NotebookToolStatus {
  const install = { path: `/tools/${name}`, version: name === "quarto" ? "1.10.19" : "0.0.61", source: "managed" as const };
  return {
    tool: name,
    pinnedVersion: install.version,
    active: installed ? install : null,
    system: null,
    managed: installed ? install : null,
    offered: true,
    downloadBytes: 1_000_000,
    license: "MIT",
    installing: false,
  };
}

function toolchain(quarto: boolean, calepin = quarto): NotebookToolchainStatus {
  return { quarto: toolStatus("quarto", quarto), calepin: toolStatus("calepin", calepin), runtimes: [] };
}

function htmlResult(path = "/project/.oleafly/build/report.html"): CompileResult {
  return {
    ok: true,
    has_pdf: false,
    output_id: null,
    output_revision: null,
    log: "Output created: report.html\n",
    errors: [{ line: null, file: null, message: "code did not run", kind: "warning", explanation: null, code: "notebook.code_skipped" }],
    synctex_path: null,
    out_dir: "/project/.oleafly/build",
    compile_time_ms: 12,
    html_output: path,
  } as CompileResult;
}

function pdfResult(bytes: Uint8Array, revision: number): CompileResult {
  return {
    ok: true,
    has_pdf: true,
    output_id: fingerprintCompileOutput(bytes),
    output_revision: revision,
    log: "done\n",
    errors: [],
    synctex_path: null,
    out_dir: null,
    compile_time_ms: 5,
  };
}

function appError(code: string, params: Record<string, string> = {}): string {
  return `${APP_ERROR_PREFIX}${JSON.stringify({ code, params, detail: null })}`;
}

function refreshStatuses(): string[] {
  return mocks.refreshPreviewWindow.mock.calls.map(([state]) => (state as { status: string }).status);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.projectId = "project";
  mocks.files.engine = notebookEngine("quarto");
  mocks.files.engineLoaded = true;
  mocks.files.mainDoc = "report.qmd";
  mocks.files.activePath = "report.qmd";
  mocks.files.tree = [{ path: "report.qmd", is_dir: false }];
  mocks.files.files = { "report.qmd": { content: "# Hello", dirty: false } };
  mocks.notebookToolchainStatus.mockResolvedValue(toolchain(true));
  useNotebookToolchainStore.setState({ status: toolchain(true), loading: false, loadFailed: false, installs: {}, removing: null });
  useProjectAnalysisStore.getState().reset();
  useProjectAnalysisStore.getState().activateProject({
    projectId: "project",
    projectRevision: 1,
    languageServiceGeneration: 0,
  });
  useCompileStore.getState().reset();
  useCompileStore.setState({
    autoCompile: false,
    checkSyntaxBeforeCompile: false,
    livePreview: { projectId: null, enabled: false, status: "off", message: null },
  });
});

describe("a compile that writes a web page", () => {
  it("records the page and reads no PDF", async () => {
    mocks.compileProject.mockResolvedValue(htmlResult());
    await useCompileStore.getState().recompile();
    const state = useCompileStore.getState();
    expect(state.status).toBe("success");
    expect(state.failureReason).toBeNull();
    expect(state.htmlOutput).toEqual({
      projectId: "project",
      path: "/project/.oleafly/build/report.html",
      builtAt: expect.any(Number),
    });
    expect(state.errors.map((error) => error.code)).toEqual(["notebook.code_skipped"]);
    expect(state.log).toContain("Output created: report.html");
    expect(state.compileTimeMs).toBe(12);
    expect(state.pdfBytes).toBeNull();
    expect(state.lastCompileCheckpoint).toBeNull();
    expect(mocks.readCompiledPdf).not.toHaveBeenCalled();
    expect(mocks.notifyCompileSucceeded).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(refreshStatuses()).toContain("compiling"));
    expect(refreshStatuses()).not.toContain("success");
  });

  it("forgets the page when a PDF compile for the project succeeds", async () => {
    mocks.compileProject.mockResolvedValue(htmlResult());
    await useCompileStore.getState().recompile();
    expect(useCompileStore.getState().htmlOutput).not.toBeNull();
    const bytes = new Uint8Array([1, 2, 3]);
    mocks.compileProject.mockResolvedValue(pdfResult(bytes, 7));
    mocks.readCompiledPdf.mockResolvedValue(bytes.buffer);
    await useCompileStore.getState().recompile();
    expect(useCompileStore.getState().htmlOutput).toBeNull();
    expect(useCompileStore.getState().lastCompileCheckpoint?.outputRevision).toBe(7);
  });

  it("keeps the page through a failed compile and drops it on reset", async () => {
    mocks.compileProject.mockResolvedValue(htmlResult());
    await useCompileStore.getState().recompile();
    mocks.compileProject.mockResolvedValue({ ...htmlResult(), ok: false, html_output: null });
    await useCompileStore.getState().recompile();
    expect(useCompileStore.getState().status).toBe("error");
    expect(useCompileStore.getState().htmlOutput?.projectId).toBe("project");
    useCompileStore.getState().reset();
    expect(useCompileStore.getState().htmlOutput).toBeNull();
  });
});

describe("a compile that needs code to run", () => {
  it("puts the refusal in the errors so the log and the banner show it", async () => {
    mocks.compileProject.mockRejectedValue(appError("notebook.code_needed", { engine: "Quarto" }));
    await useCompileStore.getState().recompile();
    const message = enErrors.notebook.code_needed.replace("{{engine}}", "Quarto");
    const state = useCompileStore.getState();
    expect(state.status).toBe("error");
    expect(state.errors).toEqual([
      { kind: "error", code: "notebook.code_needed", message, line: null, file: null, explanation: null },
    ]);
    expect(state.failureReason).toBe(message);
    expect(state.log).toContain(message);
  });

  it("keeps other failures as the generic compile failure", async () => {
    mocks.compileProject.mockRejectedValue("quarto exited with code 1");
    await useCompileStore.getState().recompile();
    const state = useCompileStore.getState();
    expect(state.status).toBe("error");
    expect(state.errors).toEqual([]);
    expect(state.failureReason).toBe("Compile failed: quarto exited with code 1");
  });
});

describe("a missing Quarto or Calepin", () => {
  it("turns the backend refusal into an offer for the right tool", async () => {
    mocks.compileProject.mockRejectedValue(appError("notebook.quarto_missing"));
    await useCompileStore.getState().recompile();
    const state = useCompileStore.getState();
    expect(state.status).toBe("unavailable");
    expect(state.failureReason).toBe(enErrors.notebook.quarto_missing);
    expect(state.offer).toEqual({ kind: "notebook-tool-missing", projectId: "project", tool: "quarto" });
    expect(mocks.logError).toHaveBeenCalledWith("compile", appError("notebook.quarto_missing"));
    await vi.waitFor(() => expect(mocks.notebookToolchainStatus).toHaveBeenCalled());
  });

  it("stops before compiling when the tool is not installed", async () => {
    mocks.files.engine = notebookEngine("calepin");
    mocks.files.mainDoc = "report.typ";
    useNotebookToolchainStore.setState({ status: toolchain(true, false) });
    mocks.notebookToolchainStatus.mockResolvedValue(toolchain(true, false));
    await useCompileStore.getState().recompile();
    expect(mocks.compileProject).not.toHaveBeenCalled();
    expect(mocks.notebookToolchainStatus).toHaveBeenCalledOnce();
    const state = useCompileStore.getState();
    expect(state.status).toBe("unavailable");
    expect(state.failureReason).toBe(enErrors.notebook.calepin_missing);
    expect(state.offer).toEqual({ kind: "notebook-tool-missing", projectId: "project", tool: "calepin" });
  });

  it("checks again before refusing, so a tool installed elsewhere compiles", async () => {
    useNotebookToolchainStore.setState({ status: toolchain(false) });
    mocks.notebookToolchainStatus.mockResolvedValue(toolchain(true));
    mocks.compileProject.mockResolvedValue(htmlResult());
    await useCompileStore.getState().recompile();
    expect(mocks.compileProject).toHaveBeenCalledOnce();
    expect(useCompileStore.getState().status).toBe("success");
  });

  it("trusts what it knows for an automatic compile instead of checking this computer again", async () => {
    useNotebookToolchainStore.setState({ status: toolchain(false) });
    await useCompileStore.getState().recompile({ origin: "automatic" });
    expect(mocks.notebookToolchainStatus).not.toHaveBeenCalled();
    expect(mocks.compileProject).not.toHaveBeenCalled();
    expect(useCompileStore.getState().offer).toEqual({ kind: "notebook-tool-missing", projectId: "project", tool: "quarto" });
  });

  it("says the tool is still installing", async () => {
    useNotebookToolchainStore.setState({
      status: toolchain(false),
      installs: { quarto: { tool: "quarto", phase: "downloading", receivedBytes: 1, totalBytes: 2 } },
    });
    mocks.notebookToolchainStatus.mockResolvedValue(toolchain(false));
    await useCompileStore.getState().recompile();
    expect(mocks.compileProject).not.toHaveBeenCalled();
    expect(useCompileStore.getState().failureReason).toBe(enErrors.notebook.busy.replace("{{tool}}", "Quarto"));
  });

  it("installs the tool from the offer and compiles again", async () => {
    useNotebookToolchainStore.setState({ status: toolchain(false) });
    mocks.notebookToolchainStatus.mockResolvedValue(toolchain(false));
    await useCompileStore.getState().recompile();
    expect(useCompileStore.getState().offer?.kind).toBe("notebook-tool-missing");
    mocks.installNotebookTool.mockResolvedValue(toolchain(true));
    mocks.compileProject.mockResolvedValue(htmlResult());
    await installMissingNotebookTool("project", "quarto");
    expect(mocks.installNotebookTool).toHaveBeenCalledWith("quarto", expect.any(Function));
    await vi.waitFor(() => expect(useCompileStore.getState().status).toBe("success"));
    expect(useCompileStore.getState().offer).toBeNull();
  });

  it("opens the tool's settings tab when the offer is accepted", async () => {
    acceptCompileOffer({ kind: "notebook-tool-missing", projectId: "project", tool: "quarto" });
    await vi.waitFor(() => expect(mocks.settings.setSettingsOpen).toHaveBeenCalledWith(true));
    expect(mocks.settings.setSettingsInitialSection).toHaveBeenCalledWith("engine");
    expect(mocks.settings.setSettingsScrollTarget).toHaveBeenCalledWith(QUARTO_SETTINGS_TARGET);
  });
});
