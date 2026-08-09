import { beforeEach, describe, expect, it, vi } from "vitest";
import { canUseFigureMode, LATEX_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getProjectEngine: vi.fn(),
  createProjectFromTemplate: vi.fn(),
  importOverleafProjectCmd: vi.fn(),
  setProjectEngineCmd: vi.fn(),
  recordProjectTexSpec: vi.fn(),
  projectMutationGeneration: vi.fn(),
  gitRestore: vi.fn(),
  gitPull: vi.fn(),
  gitDiscard: vi.fn(),
  listFiles: vi.fn(),
  readFileContent: vi.fn(),
  writeFileContent: vi.fn(),
  logError: vi.fn(),
  notifyError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  setMainDocCmd: vi.fn(),
  setProjectShellEscapeCmd: vi.fn(),
  deleteFile: vi.fn(),
  resetCompile: vi.fn(),
  flushAutoCommit: vi.fn(),
  scheduleAutoCommit: vi.fn(),
  mcpSetActiveProject: vi.fn(async () => {}),
  flushWysiwygPendingEdits: vi.fn(),
  invalidateWysiwygProjectSession: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  getProject: mocks.getProject,
  getProjectEngine: mocks.getProjectEngine,
  createProjectFromTemplate: mocks.createProjectFromTemplate,
  importOverleafProjectCmd: mocks.importOverleafProjectCmd,
  setProjectEngineCmd: mocks.setProjectEngineCmd,
  recordProjectTexSpec: mocks.recordProjectTexSpec,
  projectMutationGeneration: mocks.projectMutationGeneration,
  gitRestore: mocks.gitRestore,
  gitPull: mocks.gitPull,
  gitDiscard: mocks.gitDiscard,
  listFiles: mocks.listFiles,
  readFileContent: mocks.readFileContent,
  writeFileContent: mocks.writeFileContent,
  setMainDocCmd: mocks.setMainDocCmd,
  setProjectShellEscapeCmd: mocks.setProjectShellEscapeCmd,
  deleteFile: mocks.deleteFile,
  listProjects: vi.fn(async () => []),
  mcpSetActiveProject: mocks.mcpSetActiveProject,
}));
vi.mock("@/lib/auto-commit", () => ({
  flushAutoCommit: mocks.flushAutoCommit,
  scheduleAutoCommit: mocks.scheduleAutoCommit,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: { info: mocks.toastInfo, success: mocks.toastSuccess },
}));
vi.mock("@/store/diff", () => ({ useDiffStore: { getState: () => ({ clearActiveDiff: vi.fn() }) } }));
vi.mock("@/store/tab-order", () => ({ nextTabSeq: () => 1 }));
vi.mock("@/store/compile", () => ({
  useCompileStore: {
    getState: () => ({ reset: mocks.resetCompile }),
  },
}));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  flushWysiwygPendingEdits: mocks.flushWysiwygPendingEdits,
  invalidateWysiwygProjectSession: mocks.invalidateWysiwygProjectSession,
}));

import { useFilesStore } from "./files";
import { useSettingsStore } from "./settings";

let projectStateRevision = 10_000;

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
  mocks.logError.mockReset().mockResolvedValue(undefined);
  mocks.toastInfo.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.writeFileContent.mockReset().mockResolvedValue(undefined);
  mocks.flushAutoCommit.mockReset();
  mocks.scheduleAutoCommit.mockReset();
  mocks.getProject.mockReset().mockResolvedValue({ name: "Paper", kind: "", main_doc: "main.tex" });
  mocks.createProjectFromTemplate.mockReset().mockResolvedValue("templated-project");
  mocks.importOverleafProjectCmd.mockReset().mockResolvedValue("imported-project");
  mocks.setProjectEngineCmd.mockReset().mockResolvedValue(undefined);
  mocks.recordProjectTexSpec.mockReset().mockResolvedValue(undefined);
  mocks.projectMutationGeneration.mockReset().mockResolvedValue(0);
  mocks.listFiles.mockReset().mockResolvedValue([{ path: "main.tex", is_dir: false }]);
  mocks.readFileContent.mockReset().mockResolvedValue("hello");
  mocks.getProjectEngine.mockReset();
  mocks.gitRestore.mockReset().mockImplementation(async () => ({
    projectId: "project",
    revision: ++projectStateRevision,
    reason: "git-restore",
    filesChanged: true,
    mutationGeneration: 1,
    project: {
      name: "Paper",
      main_doc: "main.tex",
      engine: "latex",
      kind: "",
      allow_shell_escape: false,
    },
    engine: LATEX_ENGINE,
  }));
  mocks.gitPull.mockReset().mockImplementation(async () => ({
    message: "Pulled",
    state: await mocks.gitRestore(),
  }));
  mocks.gitDiscard.mockReset().mockImplementation(async () => mocks.gitRestore());
  mocks.setMainDocCmd.mockReset();
  mocks.setProjectShellEscapeCmd.mockReset();
  mocks.deleteFile.mockReset().mockResolvedValue(undefined);
  mocks.resetCompile.mockReset();
  mocks.mcpSetActiveProject.mockReset().mockResolvedValue(undefined);
  mocks.flushWysiwygPendingEdits.mockReset();
  mocks.invalidateWysiwygProjectSession.mockReset();
  useSettingsStore.setState({ defaultLatexEngine: "tectonic" });
});

function seedProjectMetadata() {
  const engine = {
    ...LATEX_ENGINE,
    id: "latexmk" as const,
    label: "LaTeX (latexmk)",
    allow_shell_escape: false,
  };
  useFilesStore.setState({
    projectId: "project",
    projectName: "Before",
    mainDoc: "main.tex",
    engine: LATEX_ENGINE,
    engineLoaded: true,
  });
  return engine;
}

describe("transactional project transitions", () => {
  it("applies authoritative project metadata events and ignores an older revision", async () => {
    const engine = seedProjectMetadata();
    const revision = ++projectStateRevision;

    await useFilesStore.getState().applyProjectStateChanged({
      projectId: "project",
      revision,
      reason: "git-pull",
      filesChanged: false,
      mutationGeneration: 7,
      project: {
        name: "After",
        main_doc: "paper.tex",
        engine: "latexmk",
        kind: "document",
        allow_shell_escape: false,
      },
      engine,
    });
    expect(useFilesStore.getState()).toMatchObject({
      projectName: "After",
      projectKind: "document",
      mainDoc: "paper.tex",
      engine,
      engineLoaded: true,
    });

    await useFilesStore.getState().applyProjectStateChanged({
      projectId: "project",
      revision: revision - 1,
      reason: "stale",
      filesChanged: false,
      mutationGeneration: 6,
      project: {
        name: "Stale",
        main_doc: "stale.tex",
        engine: "latex",
        kind: "",
        allow_shell_escape: false,
      },
      engine: LATEX_ENGINE,
    });
    expect(useFilesStore.getState().projectName).toBe("After");
    expect(useFilesStore.getState().mainDoc).toBe("paper.tex");
  });

  it("publishes a changed worktree and its reloaded buffers atomically", async () => {
    const updatedTree = [
      { path: "main.tex", is_dir: false },
      { path: "new.tex", is_dir: false },
    ];
    mocks.listFiles.mockResolvedValue(updatedTree);
    mocks.readFileContent.mockResolvedValue("remote revision");
    useFilesStore.setState({
      projectId: "project",
      projectName: "Before",
      mainDoc: "main.tex",
      engine: LATEX_ENGINE,
      engineLoaded: true,
      tree: [{ path: "main.tex", is_dir: false }],
      files: {
        "main.tex": { content: "old revision", dirty: false },
        "removed.tex": { content: "removed", dirty: false },
      },
      openTabs: ["main.tex", "removed.tex"],
      tabOrder: { "main.tex": 1, "removed.tex": 2 },
      activePath: "removed.tex",
    });

    await useFilesStore.getState().applyProjectStateChanged({
      projectId: "project",
      revision: ++projectStateRevision,
      reason: "git-pull",
      filesChanged: true,
      mutationGeneration: 8,
      project: {
        name: "After",
        main_doc: "main.tex",
        engine: "latex",
        kind: "",
        allow_shell_escape: false,
      },
      engine: LATEX_ENGINE,
    });

    expect(useFilesStore.getState()).toMatchObject({
      projectName: "After",
      tree: updatedTree,
      files: { "main.tex": { content: "remote revision", dirty: false } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });
    expect(useFilesStore.getState().files["removed.tex"]).toBeUndefined();
  });

  it("keeps a local edit dirty when a project reload overtakes its save", async () => {
    const staleWrite = deferred<void>();
    mocks.writeFileContent
      .mockImplementationOnce(() => staleWrite.promise)
      .mockResolvedValue(undefined);
    useFilesStore.setState({
      projectId: "project",
      files: { "main.tex": { content: "local edit", dirty: true } },
      tree: [{ path: "main.tex", is_dir: false }],
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });

    const saving = useFilesStore.getState().saveFile("main.tex");
    await vi.waitFor(() => expect(mocks.writeFileContent).toHaveBeenCalledTimes(1));
    await useFilesStore.getState().applyProjectStateChanged({
      projectId: "project",
      revision: ++projectStateRevision,
      reason: "git-pull",
      filesChanged: true,
      mutationGeneration: 8,
      project: {
        name: "Paper",
        main_doc: "main.tex",
        engine: "latex",
        kind: "",
        allow_shell_escape: false,
      },
      engine: LATEX_ENGINE,
    });

    staleWrite.resolve();
    await saving;
    expect(useFilesStore.getState().files["main.tex"]).toEqual({
      content: "local edit",
      dirty: true,
    });

    await useFilesStore.getState().saveFile("main.tex");
    expect(mocks.writeFileContent).toHaveBeenCalledTimes(2);
    expect(useFilesStore.getState().files["main.tex"].dirty).toBe(false);
  });

  it("restarts an in-flight project open when an authoritative event lands between reads", async () => {
    const staleMeta = deferred<{
      name: string;
      kind: string;
      main_doc: string;
      engine: string;
    }>();
    mocks.getProject
      .mockReset()
      .mockReturnValueOnce(staleMeta.promise)
      .mockResolvedValue({
        name: "Authoritative",
        kind: "",
        main_doc: "main.tex",
        engine: "latex",
      });
    mocks.getProjectEngine.mockResolvedValue(LATEX_ENGINE);

    const opening = useFilesStore.getState().openProject("project");
    await vi.waitFor(() => expect(useFilesStore.getState().projectId).toBe("project"));
    await useFilesStore.getState().applyProjectStateChanged({
      projectId: "project",
      revision: ++projectStateRevision,
      reason: "git-pull",
      filesChanged: false,
      mutationGeneration: 9,
      project: {
        name: "Authoritative",
        main_doc: "main.tex",
        engine: "latex",
        kind: "",
        allow_shell_escape: false,
      },
      engine: LATEX_ENGINE,
    });
    staleMeta.resolve({
      name: "Stale",
      kind: "",
      main_doc: "main.tex",
      engine: "latex",
    });
    await opening;

    await vi.waitFor(() => expect(mocks.getProject).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(useFilesStore.getState().loading).toBe(false));
    expect(useFilesStore.getState().projectName).toBe("Authoritative");
  });

  it("keeps imported projects on the backend's safe engine even when system TeX is the default", async () => {
    useSettingsStore.setState({ defaultLatexEngine: "latexmk" });
    mocks.getProject.mockResolvedValue({
      name: "Imported",
      kind: "",
      main_doc: "main.tex",
      engine: "latex",
    });
    mocks.getProjectEngine.mockResolvedValue(LATEX_ENGINE);

    await expect(
      useFilesStore.getState().importProject("/tmp/untrusted-project.zip"),
    ).resolves.toBe("imported-project");

    expect(mocks.importOverleafProjectCmd).toHaveBeenCalledWith(
      "/tmp/untrusted-project.zip",
    );
    expect(mocks.setProjectEngineCmd).not.toHaveBeenCalled();
    expect(mocks.recordProjectTexSpec).not.toHaveBeenCalled();
    expect(useFilesStore.getState().engine).toEqual(LATEX_ENGINE);
  });

  it("keeps downloaded and custom templates on the backend's safe engine", async () => {
    useSettingsStore.setState({ defaultLatexEngine: "latexmk" });
    mocks.getProject.mockResolvedValue({
      name: "Templated",
      kind: "",
      main_doc: "main.tex",
      engine: "latex",
    });
    mocks.getProjectEngine.mockResolvedValue(LATEX_ENGINE);

    await expect(
      useFilesStore
        .getState()
        .createFromTemplate("Templated", "downloaded-template", "blue"),
    ).resolves.toBe("templated-project");

    expect(mocks.createProjectFromTemplate).toHaveBeenCalledWith(
      "Templated",
      "downloaded-template",
      "blue",
    );
    expect(mocks.setProjectEngineCmd).not.toHaveBeenCalled();
    expect(mocks.recordProjectTexSpec).not.toHaveBeenCalled();
    expect(useFilesStore.getState().engine).toEqual(LATEX_ENGINE);
  });

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
        expect.any(Number),
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
      0,
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

  it("flushes an unsaved buffer before restoring Git history", async () => {
    const write = deferred<void>();
    mocks.writeFileContent.mockReturnValue(write.promise);
    useFilesStore.setState({
      projectId: "project",
      tree: [{ path: "main.tex", is_dir: false }],
      files: { "main.tex": { content: "unsaved local edit", dirty: true } },
      openTabs: ["main.tex"],
      tabOrder: { "main.tex": 1 },
      activePath: "main.tex",
    });

    const restoring = useFilesStore.getState().restoreFromGit("restored-oid");
    await vi.waitFor(() =>
      expect(mocks.writeFileContent).toHaveBeenCalledWith(
        "project",
        "main.tex",
        "unsaved local edit",
        expect.any(Number),
      ),
    );
    expect(mocks.gitRestore).not.toHaveBeenCalled();

    write.resolve();
    await restoring;
    expect(mocks.gitRestore).toHaveBeenCalledWith("project", "restored-oid", 0);
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
      expect.any(Number),
    );
    expect(mocks.writeFileContent).toHaveBeenCalledWith(
      "old-project",
      "notes.tex",
      "notes changes",
      expect.any(Number),
    );
    expect(mocks.flushAutoCommit).toHaveBeenCalledTimes(1);
    expect(useFilesStore.getState().projectId).toBeNull();
    expect(useFilesStore.getState().files).toEqual({});
  });

  it("flushes pending Visual edits before collecting dirty buffers for close", async () => {
    useFilesStore.setState({
      projectId: "project",
      files: { "main.tex": { content: "persisted source", dirty: false } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });
    mocks.flushWysiwygPendingEdits.mockImplementation(() => {
      useFilesStore.getState().setContent("main.tex", "pending visual edit");
    });

    await useFilesStore.getState().closeProject();

    expect(mocks.flushWysiwygPendingEdits).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateWysiwygProjectSession).toHaveBeenCalledTimes(1);
    expect(mocks.writeFileContent).toHaveBeenCalledWith(
      "project",
      "main.tex",
      "pending visual edit",
      expect.any(Number),
    );
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
        expect.any(Number),
      ),
    );
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(useFilesStore.getState().projectId).toBe("old-project");

    write.resolve();
    await opening;

    expect(mocks.getProject).toHaveBeenCalledWith("replacement");
    expect(mocks.invalidateWysiwygProjectSession).toHaveBeenCalledTimes(1);
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
    const oldWrite = deferred<{ generation: number }>();
    const newWrite = deferred<{ generation: number }>();
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
    oldWrite.resolve({ generation: 8 });
    await saving;
    await vi.waitFor(() => expect(mocks.writeFileContent).toHaveBeenCalledTimes(2));
    expect(useFilesStore.getState().projectId).toBe("project");
    newWrite.resolve({ generation: 9 });
    await closing;

    expect(mocks.writeFileContent.mock.calls.map((call) => call[2])).toEqual([
      "old snapshot",
      "new snapshot",
    ]);
    expect(mocks.writeFileContent.mock.calls.map((call) => call[3])).toEqual([0, 8]);
    expect(useFilesStore.getState().projectId).toBeNull();
  });

  it("retries a dirty snapshot after a stale generation conflict", async () => {
    vi.useFakeTimers();
    try {
      mocks.projectMutationGeneration
        .mockReset()
        .mockResolvedValueOnce(7)
        .mockResolvedValue(8);
      mocks.writeFileContent
        .mockRejectedValueOnce(new Error("mutation conflict at generation 8: target changed"))
        .mockResolvedValueOnce({ generation: 9 });
      useFilesStore.setState({
        projectId: "project",
        files: { "main.tex": { content: "local snapshot", dirty: true } },
        openTabs: ["main.tex"],
        activePath: "main.tex",
      });

      await expect(useFilesStore.getState().saveFile("main.tex")).rejects.toThrow(
        "mutation conflict",
      );
      expect(useFilesStore.getState().files["main.tex"].dirty).toBe(true);

      await vi.advanceTimersByTimeAsync(1_500);
      await vi.waitFor(() => expect(mocks.writeFileContent).toHaveBeenCalledTimes(2));
      expect(mocks.writeFileContent.mock.calls.map((call) => call[3])).toEqual([7, 8]);
      expect(useFilesStore.getState().files["main.tex"].dirty).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("external filesystem reconciliation", () => {
  it("preserves a dirty local edit after an external write races an in-flight save", async () => {
    const staleWrite = deferred<void>();
    mocks.writeFileContent
      .mockImplementationOnce(() => staleWrite.promise)
      .mockResolvedValue(undefined);
    useFilesStore.setState({
      projectId: "project",
      files: { "main.tex": { content: "stale local edit", dirty: true } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });

    const saving = useFilesStore.getState().saveFile("main.tex");
    await vi.waitFor(() => expect(mocks.writeFileContent).toHaveBeenCalledTimes(1));
    useFilesStore
      .getState()
      .applyExternalWrite("project", "main.tex", "external edit");

    expect(useFilesStore.getState().files["main.tex"]).toEqual({
      content: "stale local edit",
      dirty: true,
    });
    expect(mocks.writeFileContent).toHaveBeenCalledTimes(1);

    staleWrite.resolve();
    await saving;
    await vi.waitFor(() => expect(mocks.writeFileContent).toHaveBeenCalledTimes(2));
    expect(mocks.writeFileContent.mock.calls.map((call) => call[2])).toEqual([
      "stale local edit",
      "stale local edit",
    ]);
    await vi.waitFor(() =>
      expect(useFilesStore.getState().files["main.tex"]).toEqual({
        content: "stale local edit",
        dirty: false,
      }),
    );
    expect(mocks.toastInfo).toHaveBeenCalledWith(expect.stringContaining("local edit was kept"));
  });

  it("applies an external write directly when the local buffer is clean", () => {
    useFilesStore.setState({
      projectId: "project",
      files: { "main.tex": { content: "old", dirty: false } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });

    useFilesStore.getState().applyExternalWrite("project", "main.tex", "external edit");

    expect(useFilesStore.getState().files["main.tex"]).toEqual({
      content: "external edit",
      dirty: false,
    });
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
  });

  it("remaps every open descendant when an external folder is renamed", () => {
    useFilesStore.setState({
      projectId: "project",
      files: {
        "chapters/one.tex": { content: "one", dirty: false },
        "chapters/nested/two.tex": { content: "two", dirty: true },
        "main.tex": { content: "main", dirty: false },
      },
      openTabs: ["chapters/one.tex", "chapters/nested/two.tex", "main.tex"],
      tabOrder: { "chapters/one.tex": 1, "chapters/nested/two.tex": 2, "main.tex": 3 },
      activePath: "chapters/nested/two.tex",
    });

    useFilesStore.getState().applyExternalRename("project", "chapters", "sections");

    expect(useFilesStore.getState()).toMatchObject({
      files: {
        "sections/one.tex": { content: "one", dirty: false },
        "sections/nested/two.tex": { content: "two", dirty: true },
        "main.tex": { content: "main", dirty: false },
      },
      openTabs: ["sections/one.tex", "sections/nested/two.tex", "main.tex"],
      tabOrder: { "sections/one.tex": 1, "sections/nested/two.tex": 2, "main.tex": 3 },
      activePath: "sections/nested/two.tex",
    });
    expect(useFilesStore.getState().files["chapters/one.tex"]).toBeUndefined();
    expect(Object.keys(useFilesStore.getState().files).sort()).toEqual([
      "main.tex",
      "sections/nested/two.tex",
      "sections/one.tex",
    ]);
  });

  it("remaps the persisted main-document identity and reloads its engine", async () => {
    mocks.getProjectEngine.mockResolvedValue(LATEX_ENGINE);
    useFilesStore.setState({
      projectId: "project",
      mainDoc: "chapters/main.tex",
      files: { "chapters/main.tex": { content: "main", dirty: false } },
      openTabs: ["chapters/main.tex"],
      activePath: "chapters/main.tex",
    });

    expect(
      useFilesStore.getState().applyExternalRename("project", "chapters", "sections"),
    ).toBe(true);

    expect(useFilesStore.getState().mainDoc).toBe("sections/main.tex");
    await vi.waitFor(() => expect(mocks.resetCompile).toHaveBeenCalledOnce());
    expect(mocks.getProjectEngine).toHaveBeenCalledWith("project");
    expect(useFilesStore.getState()).toMatchObject({
      engine: LATEX_ENGINE,
      engineLoaded: true,
      engineError: null,
    });
  });

  it("drops every open descendant and tab-order entry after an external folder delete", () => {
    useFilesStore.setState({
      projectId: "project",
      files: {
        "chapters/one.tex": { content: "one", dirty: false },
        "chapters/nested/two.tex": { content: "two", dirty: false },
        "main.tex": { content: "main", dirty: false },
      },
      openTabs: ["chapters/one.tex", "chapters/nested/two.tex", "main.tex"],
      tabOrder: { "chapters/one.tex": 1, "chapters/nested/two.tex": 2, "main.tex": 3 },
      activePath: "chapters/one.tex",
    });

    useFilesStore.getState().applyExternalDelete("project", "chapters");

    expect(useFilesStore.getState()).toMatchObject({
      files: { "main.tex": { content: "main", dirty: false } },
      openTabs: ["main.tex"],
      tabOrder: { "main.tex": 3 },
      activePath: "main.tex",
    });
    expect(Object.keys(useFilesStore.getState().files)).toEqual(["main.tex"]);
    expect(Object.keys(useFilesStore.getState().tabOrder)).toEqual(["main.tex"]);
  });

  it("restores a dirty buffer when an external delete races a local edit", async () => {
    useFilesStore.setState({
      projectId: "project",
      files: { "notes.tex": { content: "unsaved", dirty: true } },
      openTabs: ["notes.tex"],
      tabOrder: { "notes.tex": 1 },
      activePath: "notes.tex",
    });

    const applied = useFilesStore.getState().applyExternalDelete("project", "notes.tex");

    expect(applied).toBe(false);
    expect(useFilesStore.getState().files["notes.tex"]).toEqual({
      content: "unsaved",
      dirty: true,
    });
    await vi.waitFor(() =>
      expect(mocks.writeFileContent).toHaveBeenCalledWith(
        "project",
        "notes.tex",
        "unsaved",
        expect.any(Number),
      ),
    );
    await vi.waitFor(() =>
      expect(useFilesStore.getState().files["notes.tex"]).toEqual({
        content: "unsaved",
        dirty: false,
      }),
    );
  });
});

describe("MCP active-project synchronization", () => {
  it("clears the backend target when the project closes", async () => {
    useFilesStore.setState({ projectId: "project", files: {} });

    await useFilesStore.getState().closeProject();

    expect(mocks.mcpSetActiveProject).toHaveBeenLastCalledWith(null);
    expect(useFilesStore.getState().projectId).toBeNull();
  });

  it("never publishes a project id that fails validation/loading", async () => {
    mocks.getProject.mockRejectedValue(new Error("missing project"));

    await useFilesStore.getState().openProject("missing");

    expect(mocks.mcpSetActiveProject.mock.calls).toEqual([[null], [null]]);
    expect(useFilesStore.getState().projectId).toBeNull();
  });

  it("publishes a validated project after first clearing the old target", async () => {
    mocks.getProjectEngine.mockResolvedValue(LATEX_ENGINE);

    await useFilesStore.getState().openProject("project");

    expect(mocks.mcpSetActiveProject.mock.calls.slice(0, 2)).toEqual([
      [null],
      ["project"],
    ]);
  });
});

describe("best-effort project loading diagnostics", () => {
  it("logs bibliography preload failures without blocking the project", async () => {
    const failure = new Error("bibliography read failed");
    mocks.getProjectEngine.mockResolvedValue(LATEX_ENGINE);
    mocks.listFiles.mockResolvedValue([
      { path: "main.tex", is_dir: false },
      { path: "references.bib", is_dir: false },
    ]);
    mocks.readFileContent.mockImplementation(async (_projectId, path) => {
      if (path === "references.bib") throw failure;
      return "hello";
    });

    await useFilesStore.getState().openProject("project");

    expect(useFilesStore.getState().projectId).toBe("project");
    expect(mocks.logError).toHaveBeenCalledWith("preload bibliography", failure);
  });

  it("logs compatibility scan failures without blocking the project", async () => {
    const failure = new Error("source read failed");
    mocks.getProjectEngine.mockResolvedValue(LATEX_ENGINE);
    mocks.listFiles.mockResolvedValue([
      { path: "main.tex", is_dir: false },
      { path: "chapter.tex", is_dir: false },
    ]);
    mocks.readFileContent.mockImplementation(async (_projectId, path) => {
      if (path === "chapter.tex") throw failure;
      return "hello";
    });

    await useFilesStore.getState().openProject("project");

    await vi.waitFor(() =>
      expect(mocks.logError).toHaveBeenCalledWith("scan project compatibility", failure),
    );
    expect(useFilesStore.getState().projectId).toBe("project");
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
      useFilesStore.getState().setContent("notes.tex", "new notes");

      const deleting = useFilesStore.getState().deleteEntry("target.tex");
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_500);

      expect(mocks.writeFileContent).toHaveBeenCalledWith(
        "project",
        "notes.tex",
        "new notes",
        expect.any(Number),
      );
      expect(mocks.writeFileContent).not.toHaveBeenCalledWith(
        "project",
        "target.tex",
        expect.anything(),
        expect.any(Number),
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

  it("refuses to delete a subtree that contains an unsaved buffer", async () => {
    useFilesStore.setState({
      projectId: "project",
      files: { "target.tex": { content: "must survive", dirty: true } },
      openTabs: ["target.tex"],
      activePath: "target.tex",
    });

    await expect(useFilesStore.getState().deleteEntry("target.tex")).rejects.toThrow(
      "Save or close the unsaved file before deleting: target.tex",
    );

    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(useFilesStore.getState().files["target.tex"]).toEqual({
      content: "must survive",
      dirty: true,
    });
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

  it("does not publish file content into a replacement project", async () => {
    const pending = deferred<string>();
    useFilesStore.setState({
      projectId: "old-project",
      files: {},
      openTabs: [],
      tabOrder: {},
      activePath: null,
    });
    mocks.readFileContent.mockReturnValue(pending.promise);

    const opening = useFilesStore.getState().openFile("late.tex");
    await vi.waitFor(() =>
      expect(mocks.readFileContent).toHaveBeenCalledWith("old-project", "late.tex")
    );
    useFilesStore.setState({
      projectId: "replacement",
      files: { "main.tex": { content: "replacement", dirty: false } },
      openTabs: ["main.tex"],
      tabOrder: { "main.tex": 1 },
      activePath: "main.tex",
    });
    pending.resolve("late content");
    await opening;

    expect(useFilesStore.getState()).toMatchObject({
      projectId: "replacement",
      files: { "main.tex": { content: "replacement", dirty: false } },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });
    expect(useFilesStore.getState().files["late.tex"]).toBeUndefined();
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

  it("publishes shell-escape consent only after the backend commits it", async () => {
    const pending = deferred<{ allow_shell_escape: boolean }>();
    mocks.setProjectShellEscapeCmd.mockReturnValue(pending.promise);
    useFilesStore.setState({
      projectId: "project",
      engine: { ...LATEX_ENGINE, id: "latexmk", allow_shell_escape: false },
      engineLoaded: true,
    });

    const changing = useFilesStore.getState().setShellEscape(true);
    await vi.waitFor(() =>
      expect(mocks.setProjectShellEscapeCmd).toHaveBeenCalledWith("project", true),
    );
    expect(useFilesStore.getState().engine.allow_shell_escape).toBe(false);
    expect(mocks.resetCompile).not.toHaveBeenCalled();

    pending.resolve({ allow_shell_escape: true });
    await changing;

    expect(mocks.resetCompile).toHaveBeenCalledOnce();
    expect(useFilesStore.getState().engine.allow_shell_escape).toBe(true);
  });
});
