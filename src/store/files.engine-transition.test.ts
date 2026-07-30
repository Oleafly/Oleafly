import { beforeEach, describe, expect, it, vi } from "vitest";
import { canUseFigureMode, LATEX_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getProjectEngine: vi.fn(),
  gitRestore: vi.fn(),
  listFiles: vi.fn(),
  readFileContent: vi.fn(),
  writeFileContent: vi.fn(),
  notifyError: vi.fn(),
  setMainDocCmd: vi.fn(),
  deleteFile: vi.fn(),
  resetCompile: vi.fn(),
  flushAutoCommit: vi.fn(),
  scheduleAutoCommit: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  getProject: mocks.getProject,
  getProjectEngine: mocks.getProjectEngine,
  gitRestore: mocks.gitRestore,
  listFiles: mocks.listFiles,
  readFileContent: mocks.readFileContent,
  writeFileContent: mocks.writeFileContent,
  setMainDocCmd: mocks.setMainDocCmd,
  deleteFile: mocks.deleteFile,
  listProjects: vi.fn(),
}));
vi.mock("@/lib/auto-commit", () => ({
  flushAutoCommit: mocks.flushAutoCommit,
  scheduleAutoCommit: mocks.scheduleAutoCommit,
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError }));
vi.mock("@/store/diff", () => ({ useDiffStore: { getState: () => ({ clearActiveDiff: vi.fn() }) } }));
vi.mock("@/store/tab-order", () => ({ nextTabSeq: () => 1 }));
vi.mock("@/store/compile", () => ({
  useCompileStore: {
    getState: () => ({ reset: mocks.resetCompile }),
  },
}));

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

beforeEach(async () => {
  mocks.writeFileContent.mockReset().mockResolvedValue(undefined);
  mocks.flushAutoCommit.mockReset();
  mocks.scheduleAutoCommit.mockReset();
  await useFilesStore.getState().closeProject();
  mocks.notifyError.mockReset();
  mocks.writeFileContent.mockReset().mockResolvedValue(undefined);
  mocks.flushAutoCommit.mockReset();
  mocks.scheduleAutoCommit.mockReset();
  mocks.getProject.mockReset().mockResolvedValue({ name: "Paper", kind: "", main_doc: "main.tex" });
  mocks.listFiles.mockReset().mockResolvedValue([{ path: "main.tex", is_dir: false }]);
  mocks.readFileContent.mockReset().mockResolvedValue("hello");
  mocks.getProjectEngine.mockReset();
  mocks.gitRestore.mockReset().mockResolvedValue(undefined);
  mocks.setMainDocCmd.mockReset();
  mocks.deleteFile.mockReset().mockResolvedValue(undefined);
  mocks.resetCompile.mockReset();
});

describe("transactional project transitions", () => {
  it("drains old writes and publishes restored buffers with the restored tree atomically", async () => {
    const write = deferred<void>();
    const restoredRead = deferred<string>();
    const oldTree = [{ path: "main.tex", is_dir: false }];
    const restoredTree = [
      { path: "main.tex", is_dir: false },
      { path: "restored.tex", is_dir: false },
    ];
    mocks.writeFileContent.mockReturnValue(write.promise);
    mocks.listFiles.mockResolvedValue(restoredTree);
    mocks.readFileContent.mockReturnValue(restoredRead.promise);
    useFilesStore.setState({
      projectId: "project",
      tree: oldTree,
      files: {
        "main.tex": { content: "stale buffer", dirty: true },
      },
      openTabs: ["main.tex"],
      tabOrder: { "main.tex": 1 },
      activePath: "main.tex",
      loading: false,
    });

    const saving = useFilesStore.getState().saveFile("main.tex");
    await vi.waitFor(() =>
      expect(mocks.writeFileContent).toHaveBeenCalledWith(
        "project",
        "main.tex",
        "stale buffer",
      ),
    );
    const restoring =
      useFilesStore.getState().restoreFromGit("restored-oid");
    await Promise.resolve();
    expect(mocks.gitRestore).not.toHaveBeenCalled();

    write.resolve();
    await saving;
    await vi.waitFor(() =>
      expect(mocks.readFileContent).toHaveBeenCalledWith(
        "project",
        "main.tex",
      ),
    );
    expect(useFilesStore.getState()).toMatchObject({
      tree: oldTree,
      files: {
        "main.tex": {
          content: "stale buffer",
        },
      },
      loading: true,
    });

    restoredRead.resolve("restored buffer");
    await restoring;
    expect(mocks.gitRestore).toHaveBeenCalledWith(
      "project",
      "restored-oid",
    );
    expect(useFilesStore.getState()).toMatchObject({
      tree: restoredTree,
      files: {
        "main.tex": {
          content: "restored buffer",
          dirty: false,
        },
      },
      openTabs: ["main.tex"],
      activePath: "main.tex",
      loading: false,
    });
  });

  it("writes every dirty buffer before closing and only then clears project state", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    mocks.writeFileContent.mockImplementation(
      (_projectId: string, path: string) =>
        path === "main.tex" ? first.promise : second.promise,
    );
    useFilesStore.setState({
      projectId: "old-project",
      files: {
        "main.tex": { content: "main changes", dirty: true },
        "notes.tex": { content: "notes changes", dirty: true },
      },
      openTabs: ["main.tex", "notes.tex"],
      activePath: "notes.tex",
    });

    const closing = useFilesStore.getState().closeProject();
    await vi.waitFor(() => expect(mocks.writeFileContent).toHaveBeenCalledTimes(2));
    expect(useFilesStore.getState().projectId).toBe("old-project");
    expect(useFilesStore.getState().files["main.tex"].content).toBe("main changes");

    first.resolve();
    second.resolve();
    await closing;

    expect(mocks.writeFileContent).toHaveBeenCalledWith(
      "old-project",
      "main.tex",
      "main changes",
    );
    expect(mocks.writeFileContent).toHaveBeenCalledWith(
      "old-project",
      "notes.tex",
      "notes changes",
    );
    expect(mocks.flushAutoCommit).toHaveBeenCalledTimes(1);
    expect(useFilesStore.getState().projectId).toBeNull();
    expect(useFilesStore.getState().files).toEqual({});
  });

  it("flushes the old project before loading a different project", async () => {
    const write = deferred<void>();
    mocks.writeFileContent.mockReturnValue(write.promise);
    mocks.getProject.mockResolvedValue({
      name: "Replacement",
      kind: "",
      main_doc: "main.tex",
    });
    mocks.getProjectEngine.mockResolvedValue(LATEX_ENGINE);
    mocks.readFileContent.mockResolvedValue("replacement content");
    useFilesStore.setState({
      projectId: "old-project",
      files: { "main.tex": { content: "unsaved", dirty: true } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });

    const opening = useFilesStore.getState().openProject("replacement");
    await vi.waitFor(() =>
      expect(mocks.writeFileContent).toHaveBeenCalledWith(
        "old-project",
        "main.tex",
        "unsaved",
      ),
    );
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(useFilesStore.getState().projectId).toBe("old-project");

    write.resolve();
    await opening;

    expect(mocks.getProject).toHaveBeenCalledWith("replacement");
    expect(useFilesStore.getState().projectId).toBe("replacement");
    expect(useFilesStore.getState().files["main.tex"].content).toBe("replacement content");
  });

  it("keeps the current project open when a transition save fails", async () => {
    const failure = new Error("disk full");
    mocks.writeFileContent.mockRejectedValue(failure);
    useFilesStore.setState({
      projectId: "old-project",
      projectName: "Old project",
      files: { "main.tex": { content: "must survive", dirty: true } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });

    await useFilesStore.getState().closeProject();

    expect(useFilesStore.getState().projectId).toBe("old-project");
    expect(useFilesStore.getState().files["main.tex"]).toEqual({
      content: "must survive",
      dirty: true,
    });
    expect(useFilesStore.getState().loading).toBe(false);
    expect(mocks.flushAutoCommit).not.toHaveBeenCalled();
    expect(mocks.notifyError).toHaveBeenCalledWith(
      "save before closing project",
      failure,
      expect.stringContaining("stayed open"),
    );
  });

  it("orders a newer close flush behind an older in-flight save", async () => {
    const oldWrite = deferred<void>();
    const newWrite = deferred<void>();
    mocks.writeFileContent
      .mockImplementationOnce(() => oldWrite.promise)
      .mockImplementationOnce(() => newWrite.promise);
    useFilesStore.setState({
      projectId: "project",
      files: { "main.tex": { content: "old snapshot", dirty: true } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });

    const saving = useFilesStore.getState().saveFile("main.tex");
    await vi.waitFor(() => expect(mocks.writeFileContent).toHaveBeenCalledTimes(1));
    useFilesStore.setState({
      files: { "main.tex": { content: "new snapshot", dirty: true } },
    });
    const closing = useFilesStore.getState().closeProject();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.writeFileContent).toHaveBeenCalledTimes(1);
    oldWrite.resolve();
    await saving;
    await vi.waitFor(() => expect(mocks.writeFileContent).toHaveBeenCalledTimes(2));
    expect(useFilesStore.getState().projectId).toBe("project");
    newWrite.resolve();
    await closing;

    expect(mocks.writeFileContent.mock.calls.map((call) => call[2])).toEqual([
      "old snapshot",
      "new snapshot",
    ]);
    expect(useFilesStore.getState().projectId).toBeNull();
  });
});

describe("delete and autosave coordination", () => {
  it("keeps unrelated dirty buffers autosaving while a delete is pending", async () => {
    vi.useFakeTimers();
    try {
      const deletion = deferred<void>();
      mocks.deleteFile.mockReturnValue(deletion.promise);
      useFilesStore.setState({
        projectId: "project",
        mainDoc: "main.tex",
        tree: [
          { path: "target.tex", is_dir: false },
          { path: "notes.tex", is_dir: false },
        ],
        files: {
          "target.tex": { content: "old target", dirty: false },
          "notes.tex": { content: "old notes", dirty: false },
        },
        openTabs: ["target.tex", "notes.tex"],
        activePath: "target.tex",
      });
      useFilesStore.getState().setContent("target.tex", "new target");
      useFilesStore.getState().setContent("notes.tex", "new notes");

      const deleting = useFilesStore.getState().deleteEntry("target.tex");
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_500);

      expect(mocks.writeFileContent).toHaveBeenCalledWith(
        "project",
        "notes.tex",
        "new notes",
      );
      expect(mocks.writeFileContent).not.toHaveBeenCalledWith(
        "project",
        "target.tex",
        expect.anything(),
      );
      deletion.resolve();
      await deleting;
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the live tab selection when a pending delete completes", async () => {
    const deletion = deferred<void>();
    mocks.deleteFile.mockReturnValue(deletion.promise);
    useFilesStore.setState({
      projectId: "project",
      mainDoc: "main.tex",
      tree: [],
      files: {
        "target.tex": { content: "target", dirty: false },
        "notes.tex": { content: "notes", dirty: false },
      },
      openTabs: ["target.tex", "notes.tex"],
      activePath: "target.tex",
    });

    const deleting = useFilesStore.getState().deleteEntry("target.tex");
    await vi.waitFor(() => expect(mocks.deleteFile).toHaveBeenCalled());
    useFilesStore.getState().setActive("notes.tex");
    deletion.resolve();
    await deleting;

    expect(useFilesStore.getState().activePath).toBe("notes.tex");
    expect(useFilesStore.getState().openTabs).toEqual(["notes.tex"]);
  });

  it("does not apply a completed delete to a replacement project", async () => {
    const deletion = deferred<void>();
    mocks.deleteFile.mockReturnValue(deletion.promise);
    useFilesStore.setState({
      projectId: "old-project",
      files: { "target.tex": { content: "target", dirty: false } },
      openTabs: ["target.tex"],
      activePath: "target.tex",
    });

    const deleting = useFilesStore.getState().deleteEntry("target.tex");
    await vi.waitFor(() => expect(mocks.deleteFile).toHaveBeenCalled());
    useFilesStore.setState({
      projectId: "replacement",
      files: { "main.tex": { content: "replacement", dirty: false } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
      tree: [{ path: "main.tex", is_dir: false }],
    });
    deletion.resolve();
    await deleting;

    expect(useFilesStore.getState().projectId).toBe("replacement");
    expect(useFilesStore.getState().activePath).toBe("main.tex");
    expect(useFilesStore.getState().files["main.tex"].content).toBe("replacement");
  });

  it("restores a deleted subtree's dirty autosave when deletion fails", async () => {
    vi.useFakeTimers();
    try {
      const failure = new Error("permission denied");
      mocks.deleteFile.mockRejectedValue(failure);
      useFilesStore.setState({
        projectId: "project",
        files: { "target.tex": { content: "unsaved", dirty: false } },
        openTabs: ["target.tex"],
        activePath: "target.tex",
      });
      useFilesStore.getState().setContent("target.tex", "must survive");

      await expect(
        useFilesStore.getState().deleteEntry("target.tex"),
      ).rejects.toBe(failure);
      await vi.advanceTimersByTimeAsync(1_500);

      expect(mocks.writeFileContent).toHaveBeenCalledWith(
        "project",
        "target.tex",
        "must survive",
      );
    } finally {
      vi.useRealTimers();
    }
  });
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
    expect(mocks.resetCompile).toHaveBeenCalledOnce();
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
    expect(useFilesStore.getState().mainDoc).toBe("main.typ");
    expect(useFilesStore.getState().engineLoaded).toBe(false);
    useFilesStore.setState({ projectId: "replacement", mainDoc: "main.md" });
    pending.resolve(LATEX_ENGINE);
    await changing;
    expect(useFilesStore.getState().projectId).toBe("replacement");
    expect(useFilesStore.getState().mainDoc).toBe("main.md");
  });
});
