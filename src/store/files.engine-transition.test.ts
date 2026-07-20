import { beforeEach, describe, expect, it, vi } from "vitest";
import { canUseFigureMode, LATEX_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getProjectEngine: vi.fn(),
  listFiles: vi.fn(),
  readFileContent: vi.fn(),
  notifyError: vi.fn(),
  setMainDocCmd: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  getProject: mocks.getProject,
  getProjectEngine: mocks.getProjectEngine,
  listFiles: mocks.listFiles,
  readFileContent: mocks.readFileContent,
  setMainDocCmd: mocks.setMainDocCmd,
  listProjects: vi.fn(),
}));
vi.mock("@/lib/auto-commit", () => ({ flushAutoCommit: vi.fn(), scheduleAutoCommit: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError }));
vi.mock("@/store/diff", () => ({ useDiffStore: { getState: () => ({ clearActiveDiff: vi.fn() }) } }));
vi.mock("@/store/tab-order", () => ({ nextTabSeq: () => 1 }));

import { useFilesStore } from "./files";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  useFilesStore.getState().closeProject();
  mocks.notifyError.mockReset();
  mocks.getProject.mockReset().mockResolvedValue({ name: "Paper", kind: "", main_doc: "main.tex" });
  mocks.listFiles.mockReset().mockResolvedValue([{ path: "main.tex", is_dir: false }]);
  mocks.readFileContent.mockReset().mockResolvedValue("hello");
  mocks.getProjectEngine.mockReset();
  mocks.setMainDocCmd.mockReset();
});

describe("project engine transition", () => {
  it("does not reopen a tab after it is closed while its content is loading", async () => {
    const pending = deferred<string>();
    useFilesStore.setState({
      projectId: "project",
      files: {},
      openTabs: ["late.tex"],
      tabOrder: { "late.tex": 1 },
      activePath: "late.tex",
    });
    mocks.readFileContent.mockReturnValue(pending.promise);

    const opening = useFilesStore.getState().openFile("late.tex");
    await vi.waitFor(() =>
      expect(mocks.readFileContent).toHaveBeenCalledWith("project", "late.tex")
    );
    useFilesStore.getState().closeTab("late.tex");
    pending.resolve("late content");
    await opening;

    expect(useFilesStore.getState().openTabs).not.toContain("late.tex");
    expect(useFilesStore.getState().activePath).toBeNull();
  });

  it("denies capabilities until the backend descriptor resolves", async () => {
    const pending = deferred<typeof LATEX_ENGINE>();
    mocks.getProjectEngine.mockReturnValue(pending.promise);
    const opening = useFilesStore.getState().openProject("project");
    await vi.waitFor(() => expect(mocks.getProjectEngine).toHaveBeenCalledWith("project"));

    const during = useFilesStore.getState();
    expect(during.loading).toBe(true);
    expect(during.engineLoaded).toBe(false);
    expect(during.engine.id).toBe("unknown");
    expect(during.engine.capabilities.features).toEqual([]);
    expect(during.engine.capabilities.conversion_exports).toEqual([]);
    expect(during.engine.capabilities.formatting_profile).toBe("none");
    expect(during.engine.capabilities.supports_synctex).toBe(false);
    expect(during.engine.capabilities.supports_isolated_compile).toBe(false);
    expect(canUseFigureMode(during.engine, during.engineLoaded)).toBe(false);

    pending.resolve(LATEX_ENGINE);
    await opening;
    const ready = useFilesStore.getState();
    expect(ready.engineLoaded).toBe(true);
    expect(ready.engine).toEqual(LATEX_ENGINE);
    expect(ready.engine.capabilities.supports_synctex).toBe(true);
    expect(canUseFigureMode(ready.engine, ready.engineLoaded)).toBe(true);
    expect(ready.loading).toBe(false);
  });

  it("remains fail-closed and surfaces an error when descriptor loading fails", async () => {
    mocks.getProjectEngine.mockRejectedValue(new Error("IPC failed"));
    await useFilesStore.getState().openProject("project");
    const state = useFilesStore.getState();
    expect(state.projectId).toBe("project");
    expect(state.engineLoaded).toBe(false);
    expect(state.engine.capabilities.supports_isolated_compile).toBe(false);
    expect(state.engineError).toContain("actions are disabled");
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "load document engine",
      expect.any(Error),
      expect.stringContaining("actions are disabled"),
    );
  });

  it("atomically refetches capabilities when AI or UI changes engine", async () => {
    useFilesStore.setState({ projectId: "project", engine: LATEX_ENGINE, engineLoaded: true });
    mocks.setMainDocCmd.mockResolvedValue({ main_doc: "main.typ", engine: "typst" });
    const typst = {
      ...LATEX_ENGINE,
      id: "typst" as const,
      label: "Typst",
      source_format: "typst" as const,
      main_document: "main.typ",
      source_extensions: ["typ"],
      capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "typst" as const, supports_synctex: false, supports_isolated_compile: false },
    };
    mocks.getProjectEngine.mockResolvedValue(typst);
    await useFilesStore.getState().setMainDoc("main.typ");
    expect(useFilesStore.getState().mainDoc).toBe("main.typ");
    expect(useFilesStore.getState().engine).toEqual(typst);
    expect(useFilesStore.getState().engine.capabilities.supports_synctex).toBe(false);
  });

  it("does not apply a main document response after a project switch", async () => {
    useFilesStore.setState({ projectId: "project", engine: LATEX_ENGINE, engineLoaded: true });
    const pending = deferred<{ main_doc: string; engine: string }>();
    mocks.setMainDocCmd.mockReturnValue(pending.promise);
    const changing = useFilesStore.getState().setMainDoc("main.typ");
    useFilesStore.setState({ projectId: "replacement", mainDoc: "main.md" });
    pending.resolve({ main_doc: "main.typ", engine: "typst" });
    await changing;
    expect(mocks.getProjectEngine).not.toHaveBeenCalled();
    expect(useFilesStore.getState().projectId).toBe("replacement");
    expect(useFilesStore.getState().mainDoc).toBe("main.md");
  });

  it("does not apply engine metadata after a project switch", async () => {
    useFilesStore.setState({ projectId: "project", engine: LATEX_ENGINE, engineLoaded: true });
    mocks.setMainDocCmd.mockResolvedValue({ main_doc: "main.typ", engine: "typst" });
    const pending = deferred<typeof LATEX_ENGINE>();
    mocks.getProjectEngine.mockReturnValue(pending.promise);
    const changing = useFilesStore.getState().setMainDoc("main.typ");
    await vi.waitFor(() => expect(mocks.getProjectEngine).toHaveBeenCalled());
    useFilesStore.setState({ projectId: "replacement", mainDoc: "main.md" });
    pending.resolve(LATEX_ENGINE);
    await changing;
    expect(useFilesStore.getState().projectId).toBe("replacement");
    expect(useFilesStore.getState().mainDoc).toBe("main.md");
  });
});
