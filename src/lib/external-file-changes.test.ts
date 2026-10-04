import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getProjectEngine: vi.fn(),
  projectMutationGeneration: vi.fn(),
  listFiles: vi.fn(),
  readFileContent: vi.fn(),
  writeFileContent: vi.fn(),
  createFile: vi.fn(),
  deleteFile: vi.fn(),
  importPathsIntoProject: vi.fn(),
  setMainDocCmd: vi.fn(),
  setProjectEngineCmd: vi.fn(),
  setProjectShellEscapeCmd: vi.fn(),
  recordProjectTexSpec: vi.fn(),
  importOverleafProjectCmd: vi.fn(),
  createProjectFromTemplate: vi.fn(),
  gitRestore: vi.fn(),
  gitPull: vi.fn(),
  gitDiscard: vi.fn(),
  mcpSetActiveProject: vi.fn(async () => {}),
  logError: vi.fn(),
  notifyError: vi.fn(),
  toastInfo: vi.fn(),
  toastInfoUnique: vi.fn(),
  toastSuccess: vi.fn(),
  resetCompile: vi.fn(),
  flushWysiwygPendingEdits: vi.fn(),
  invalidateWysiwygProjectSession: vi.fn(),
  notifyProjectFilesChanged: vi.fn(),
  rebuildFromDisk: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  getProject: mocks.getProject,
  projectManifestHome: vi.fn(async () => "library"),
  getProjectEngine: mocks.getProjectEngine,
  projectMutationGeneration: mocks.projectMutationGeneration,
  listFiles: mocks.listFiles,
  listFileTree: async (projectId: string) => ({
    entries: await mocks.listFiles(projectId),
    truncated: false,
  }),
  readFileContent: mocks.readFileContent,
  writeFileContent: mocks.writeFileContent,
  createFile: mocks.createFile,
  deleteFile: mocks.deleteFile,
  importPathsIntoProject: mocks.importPathsIntoProject,
  setMainDocCmd: mocks.setMainDocCmd,
  setProjectEngineCmd: mocks.setProjectEngineCmd,
  setProjectShellEscapeCmd: mocks.setProjectShellEscapeCmd,
  recordProjectTexSpec: mocks.recordProjectTexSpec,
  importOverleafProjectCmd: mocks.importOverleafProjectCmd,
  createProjectFromTemplate: mocks.createProjectFromTemplate,
  gitRestore: mocks.gitRestore,
  gitPull: mocks.gitPull,
  gitDiscard: mocks.gitDiscard,
  listProjects: vi.fn(async () => []),
  mcpSetActiveProject: mocks.mcpSetActiveProject,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: {
    info: mocks.toastInfo,
    infoUnique: mocks.toastInfoUnique,
    success: mocks.toastSuccess,
  },
}));
vi.mock("@/lib/cross-window", () => ({
  notifyProjectFilesChanged: mocks.notifyProjectFilesChanged,
}));
vi.mock("@/store/diff", () => ({
  useDiffStore: { getState: () => ({ clearActiveDiff: vi.fn() }) },
}));
vi.mock("@/store/tab-order", () => ({ nextTabSeq: () => 1 }));
vi.mock("@/store/compile", () => ({
  useCompileStore: { getState: () => ({ reset: mocks.resetCompile }) },
}));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  flushWysiwygPendingEdits: mocks.flushWysiwygPendingEdits,
  invalidateWysiwygProjectSession: mocks.invalidateWysiwygProjectSession,
}));
vi.mock("@/store/project-index", () => ({
  useIndexStore: { getState: () => ({ rebuildFromDisk: mocks.rebuildFromDisk }) },
}));

import { useFilesStore } from "@/store/files";
import { useProjectAvailabilityStore } from "@/store/project-availability";
import {
  applyExternalFileChange,
  applyFolderChange,
  flushOpenFilesToDisk,
  refreshOpenFilesFromDisk,
} from "./external-file-changes";

const TREE = [
  { path: "main.tex", is_dir: false },
  { path: "references.bib", is_dir: false },
];

beforeEach(async () => {
  await useFilesStore.getState().closeProject();
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.projectMutationGeneration.mockResolvedValue(3);
  mocks.listFiles.mockResolvedValue(TREE);
  mocks.readFileContent.mockResolvedValue("fresh\n");
  mocks.mcpSetActiveProject.mockResolvedValue(undefined);
  useFilesStore.setState({
    projectId: "project",
    projectName: "Paper",
    mainDoc: "main.tex",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    tree: TREE,
    files: { "references.bib": { content: "old\n", dirty: false } },
    openTabs: [],
    activePath: null,
  });
});

function notifyPaths(paths: string[]) {
  applyExternalFileChange({ projectId: "project", paths, from: "other" }, "self");
}

describe("applyExternalFileChange", () => {
  it("reloads a preloaded buffer without opening a tab for it", async () => {
    notifyPaths(["references.bib"]);

    await vi.waitFor(() => {
      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "fresh\n",
        dirty: false,
      });
    });
    const state = useFilesStore.getState();
    expect(state.openTabs).toEqual([]);
    expect(state.activePath).toBeNull();
  });

  it("keeps the tab list untouched for a buffer that is already open", async () => {
    useFilesStore.setState({ openTabs: ["main.tex"], activePath: "main.tex" });

    notifyPaths(["references.bib"]);

    await vi.waitFor(() => {
      expect(useFilesStore.getState().files["references.bib"]?.content).toBe("fresh\n");
    });
    const state = useFilesStore.getState();
    expect(state.openTabs).toEqual(["main.tex"]);
    expect(state.activePath).toBe("main.tex");
  });

  it("refreshes the file tree", async () => {
    notifyPaths(["references.bib"]);

    await vi.waitFor(() => {
      expect(mocks.listFiles).toHaveBeenCalledWith("project");
    });
  });

  it("leaves an unsaved buffer alone", async () => {
    useFilesStore.setState({
      files: { "references.bib": { content: "mine\n", dirty: true } },
    });

    notifyPaths(["references.bib"]);

    await vi.waitFor(() => {
      expect(mocks.listFiles).toHaveBeenCalled();
    });
    expect(mocks.readFileContent).not.toHaveBeenCalled();
    expect(useFilesStore.getState().files["references.bib"]).toEqual({
      content: "mine\n",
      dirty: true,
    });
  });

  it("never opens a file this window has no buffer for", async () => {
    notifyPaths(["chapters/new.tex"]);

    await vi.waitFor(() => {
      expect(mocks.listFiles).toHaveBeenCalled();
    });
    const state = useFilesStore.getState();
    expect(state.files["chapters/new.tex"]).toBeUndefined();
    expect(state.openTabs).toEqual([]);
  });

  it("ignores its own broadcast", () => {
    applyExternalFileChange(
      { projectId: "project", paths: ["references.bib"], from: "self" },
      "self",
    );

    expect(mocks.listFiles).not.toHaveBeenCalled();
  });

  it("ignores a notification for another project", () => {
    applyExternalFileChange(
      { projectId: "elsewhere", paths: ["references.bib"], from: "other" },
      "self",
    );

    expect(mocks.listFiles).not.toHaveBeenCalled();
  });

  it("still opens a tab for an explicit write change", async () => {
    applyExternalFileChange(
      {
        projectId: "project",
        paths: ["references.bib"],
        from: "other",
        change: { kind: "write", path: "references.bib", content: "written\n" },
      },
      "self",
    );

    await vi.waitFor(() => {
      expect(useFilesStore.getState().openTabs).toEqual(["references.bib"]);
    });
    expect(useFilesStore.getState().assistantTabs).toEqual(["references.bib"]);
  });
});

describe("open files and programs outside the editor", () => {
  it("reloads every clean open buffer from disk and leaves unsaved edits alone", async () => {
    useFilesStore.setState({
      files: {
        "main.tex": { content: "typed\n", dirty: true },
        "references.bib": { content: "old\n", dirty: false },
      },
      openTabs: ["main.tex"],
      activePath: "main.tex",
    });

    refreshOpenFilesFromDisk("project");

    await vi.waitFor(() => {
      expect(useFilesStore.getState().files["references.bib"]?.content).toBe("fresh\n");
    });
    expect(useFilesStore.getState().files["main.tex"]).toEqual({ content: "typed\n", dirty: true });
    expect(mocks.listFiles).toHaveBeenCalled();
  });

  it("ignores a project that is not open", () => {
    refreshOpenFilesFromDisk("other");
    expect(mocks.readFileContent).not.toHaveBeenCalled();
  });

  it("reads nothing while the folder is unavailable", async () => {
    useProjectAvailabilityStore.getState().reset("project");
    useProjectAvailabilityStore.getState().report("project", "missing");
    refreshOpenFilesFromDisk("project");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.readFileContent).not.toHaveBeenCalled();
    expect(mocks.listFiles).not.toHaveBeenCalled();
    useProjectAvailabilityStore.getState().reset(null);
  });

  it("writes unsaved edits to disk before another program runs", async () => {
    mocks.writeFileContent.mockResolvedValue({ generation: 4 });
    useFilesStore.setState({ files: { "main.tex": { content: "typed\n", dirty: true } } });

    await flushOpenFilesToDisk("project", "save before agent prompt");

    expect(mocks.writeFileContent).toHaveBeenCalledWith("project", "main.tex", "typed\n", 3);
    expect(useFilesStore.getState().files["main.tex"].dirty).toBe(false);
  });
});

describe("applyFolderChange", () => {
  async function editOpenFile(path: string, disk: string, typed: string) {
    mocks.readFileContent.mockResolvedValueOnce(disk);
    await useFilesStore.getState().openFile(path);
    useFilesStore.getState().setContent(path, typed);
  }

  it("reloads a clean buffer from disk without asking", async () => {
    mocks.readFileContent.mockResolvedValue("from another editor\n");
    applyFolderChange({ projectId: "project", paths: ["references.bib"], rescan: false });

    await vi.waitFor(() => {
      expect(useFilesStore.getState().files["references.bib"]).toEqual({
        content: "from another editor\n",
        dirty: false,
      });
    });
    expect(useFilesStore.getState().changedOnDisk).toEqual([]);
    expect(mocks.listFiles).not.toHaveBeenCalled();
  });

  it("asks about an unsaved buffer whose file changed on disk", async () => {
    await editOpenFile("main.tex", "original\n", "my edit\n");
    mocks.readFileContent.mockResolvedValue("their edit\n");

    applyFolderChange({ projectId: "project", paths: ["main.tex"], rescan: false });

    await vi.waitFor(() => {
      expect(useFilesStore.getState().changedOnDisk).toEqual(["main.tex"]);
    });
    expect(useFilesStore.getState().files["main.tex"]).toMatchObject({
      content: "my edit\n",
      dirty: true,
    });
    expect(mocks.toastInfo).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("stays quiet when the file on disk is still the version the buffer came from", async () => {
    await editOpenFile("main.tex", "original\n", "my edit\n");
    mocks.readFileContent.mockResolvedValue("original\n");

    applyFolderChange({ projectId: "project", paths: ["main.tex"], rescan: false });

    await vi.waitFor(() => {
      expect(mocks.readFileContent).toHaveBeenCalledTimes(2);
    });
    await Promise.resolve();
    expect(useFilesStore.getState().changedOnDisk).toEqual([]);
  });

  it("waits for its own save to land instead of asking about it", async () => {
    await editOpenFile("main.tex", "original\n", "my edit\n");
    let finishWrite: (value: { generation: number }) => void = () => {};
    mocks.writeFileContent.mockImplementation(
      () => new Promise((resolve) => {
        finishWrite = resolve;
      }),
    );
    const saving = useFilesStore.getState().saveFile("main.tex");
    await vi.waitFor(() => expect(mocks.writeFileContent).toHaveBeenCalled());
    useFilesStore.getState().setContent("main.tex", "my edit, continued\n");
    mocks.readFileContent.mockResolvedValue("my edit\n");

    applyFolderChange({ projectId: "project", paths: ["main.tex"], rescan: false });
    await vi.waitFor(() => expect(mocks.rebuildFromDisk).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    const flaggedWhileSaving = [...useFilesStore.getState().changedOnDisk];
    finishWrite({ generation: 4 });
    await saving;
    mocks.writeFileContent.mockResolvedValue({ generation: 5 });

    expect(flaggedWhileSaving).toEqual([]);
    expect(useFilesStore.getState().changedOnDisk).toEqual([]);
  });

  it("checks every open buffer after a rescan and the ones under a changed folder", async () => {
    useFilesStore.setState({
      files: {
        "chapters/intro.tex": { content: "old intro\n", dirty: false },
        "references.bib": { content: "old\n", dirty: false },
      },
    });
    mocks.readFileContent.mockResolvedValue("new\n");

    applyFolderChange({ projectId: "project", paths: ["chapters"], rescan: false });
    await vi.waitFor(() => {
      expect(useFilesStore.getState().files["chapters/intro.tex"]?.content).toBe("new\n");
    });
    expect(useFilesStore.getState().files["references.bib"]?.content).toBe("old\n");

    useFilesStore.setState((state) => ({
      files: {
        ...state.files,
        "chapters/intro.tex": { content: "typing\n", dirty: true },
      },
    }));
    applyFolderChange({ projectId: "project", paths: [], rescan: true });
    await vi.waitFor(() => {
      expect(useFilesStore.getState().files["references.bib"]?.content).toBe("new\n");
    });
  });

  it("ignores a change for another project", () => {
    applyFolderChange({ projectId: "elsewhere", paths: ["main.tex"], rescan: false });
    expect(mocks.listFiles).not.toHaveBeenCalled();
    expect(mocks.readFileContent).not.toHaveBeenCalled();
  });
});


describe("folder changes and the file tree", () => {
  const change = (paths: string[], structural = false) => ({
    projectId: "project",
    paths,
    rescan: false,
    structural,
  });

  it("does not list the folder again when a known file only changed its content", async () => {
    applyFolderChange(change(["references.bib"]));

    await vi.waitFor(() => expect(mocks.rebuildFromDisk).toHaveBeenCalledTimes(1));
    expect(mocks.listFiles).not.toHaveBeenCalled();
  });

  it("lists the folder again for a file it has not seen", async () => {
    mocks.listFiles.mockResolvedValue([...TREE, { path: "figures/plot.png", is_dir: false }]);

    applyFolderChange(change(["figures/plot.png"]));

    await vi.waitFor(() => {
      expect(useFilesStore.getState().tree.map((entry) => entry.path)).toContain(
        "figures/plot.png",
      );
    });
    expect(mocks.listFiles).toHaveBeenCalledTimes(1);
  });

  it("keeps the same tree when a new listing matches the old one", async () => {
    const before = useFilesStore.getState().tree;
    mocks.listFiles.mockResolvedValue(TREE.map((entry) => ({ ...entry })));

    applyFolderChange(change(["main.tex"], true));

    await vi.waitFor(() => expect(mocks.rebuildFromDisk).toHaveBeenCalledTimes(1));
    expect(mocks.listFiles).toHaveBeenCalledTimes(1);
    expect(useFilesStore.getState().tree).toBe(before);
  });

  it("leaves the project index alone when only a figure changed", async () => {
    useFilesStore.setState({ tree: [...TREE, { path: "figure.png", is_dir: false }] });

    applyFolderChange(change(["figure.png"]));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mocks.listFiles).not.toHaveBeenCalled();
    expect(mocks.rebuildFromDisk).not.toHaveBeenCalled();
  });
});

describe("external changes from other windows", () => {
  it("applies a delete or rename change directly without listing the folder", () => {
    const applyExternalDelete = vi.fn(() => true);
    const applyExternalRename = vi.fn(() => true);
    useFilesStore.setState({ applyExternalDelete, applyExternalRename });
    applyExternalFileChange(
      { projectId: "project", paths: ["old.tex"], from: "other", change: { kind: "delete", path: "old.tex" } },
      "self",
    );
    applyExternalFileChange(
      { projectId: "project", paths: ["a.tex", "b.tex"], from: "other", change: { kind: "rename", from: "a.tex", to: "b.tex" } },
      "self",
    );
    expect(applyExternalDelete).toHaveBeenCalledWith("project", "old.tex");
    expect(applyExternalRename).toHaveBeenCalledWith("project", "a.tex", "b.tex");
    expect(mocks.listFiles).not.toHaveBeenCalled();
  });

  it("only refreshes the tree for a created file and ignores payloads without a project", async () => {
    applyExternalFileChange({ projectId: "", paths: ["new.tex"], from: "other" }, "self");
    expect(mocks.listFiles).not.toHaveBeenCalled();
    applyExternalFileChange(
      { projectId: "project", paths: ["references.bib"], from: "other", change: { kind: "create", path: "references.bib" } },
      "self",
    );
    await vi.waitFor(() => expect(mocks.listFiles).toHaveBeenCalledOnce());
    expect(mocks.readFileContent).not.toHaveBeenCalled();
  });

  it("checks every open buffer when the notification names no paths", async () => {
    applyExternalFileChange({ projectId: "project", paths: [], from: "other" }, "self");
    await vi.waitFor(() => expect(useFilesStore.getState().files["references.bib"]?.content).toBe("fresh\n"));
    expect(mocks.readFileContent).toHaveBeenCalledWith("project", "references.bib");
  });

  it("keeps a buffer that was edited or switched away from while the disk read was running", async () => {
    let release: (value: string) => void = () => {};
    mocks.readFileContent.mockImplementation(() => new Promise<string>((resolve) => { release = resolve; }));
    notifyPaths(["references.bib"]);
    await vi.waitFor(() => expect(mocks.readFileContent).toHaveBeenCalledOnce());
    useFilesStore.setState({ files: { "references.bib": { content: "typed meanwhile\n", dirty: false } } });
    release("fresh\n");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useFilesStore.getState().files["references.bib"]?.content).toBe("typed meanwhile\n");

    notifyPaths(["references.bib"]);
    await vi.waitFor(() => expect(mocks.readFileContent).toHaveBeenCalledTimes(2));
    useFilesStore.setState({ projectId: "switched" });
    release("fresh\n");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useFilesStore.getState().files["references.bib"]?.content).toBe("typed meanwhile\n");
  });
});

describe("folder change edge cases", () => {
  it("reads nothing while the folder is unavailable", () => {
    useProjectAvailabilityStore.getState().reset("project");
    useProjectAvailabilityStore.getState().report("project", "missing");
    applyFolderChange({ projectId: "project", paths: ["main.tex"], rescan: true });
    expect(mocks.listFiles).not.toHaveBeenCalled();
    expect(mocks.rebuildFromDisk).not.toHaveBeenCalled();
    useProjectAvailabilityStore.getState().reset(null);
  });

  it("rebuilds the index when listing the folder fails, but not after a project switch", async () => {
    mocks.listFiles.mockRejectedValueOnce(new Error("permission denied"));
    applyFolderChange({ projectId: "project", paths: ["chapters/new.tex"], rescan: false });
    await vi.waitFor(() => expect(mocks.rebuildFromDisk).toHaveBeenCalledOnce());

    let releaseListing: (value: typeof TREE) => void = () => {};
    mocks.listFiles.mockImplementationOnce(() => new Promise((resolve) => { releaseListing = resolve; }));
    applyFolderChange({ projectId: "project", paths: ["chapters/other.tex"], rescan: false });
    await vi.waitFor(() => expect(mocks.listFiles).toHaveBeenCalledTimes(2));
    useFilesStore.setState({ projectId: "switched" });
    releaseListing(TREE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.rebuildFromDisk).toHaveBeenCalledOnce();
  });
});
