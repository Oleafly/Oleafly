import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  compileProject: vi.fn(),
  readCompiledPdf: vi.fn(),
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
vi.mock("@/lib/preview-window", () => ({ refreshPreviewWindow: vi.fn() }));
vi.mock("@/lib/cross-window", () => ({ notifyCompileDone: vi.fn() }));

import { useCompileStore } from "./compile";

beforeEach(() => {
  mocks.compileProject.mockReset();
  mocks.readCompiledPdf.mockReset();
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
    mocks.compileProject.mockResolvedValue({ ok: false, has_pdf: true, log: "failed", errors: [], synctex_path: null, out_dir: "/build", compile_time_ms: 1 });
    mocks.readCompiledPdf.mockResolvedValue(new Uint8Array([1]).buffer);
    useCompileStore.setState({ pdfBytes: new Uint8Array([9]), lastCompiledAt: 123 });
    await useCompileStore.getState().recompile();
    expect(useCompileStore.getState().status).toBe("error");
    expect(useCompileStore.getState().pdfBytes).toEqual(new Uint8Array([1]));
    expect(useCompileStore.getState().lastCompiledAt).toBe(123);
    expect(mocks.readCompiledPdf).toHaveBeenCalledOnce();
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
});
