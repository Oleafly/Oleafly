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
}));

vi.mock("@/lib/tauri", () => ({
  getProject: mocks.getProject,
  getProjectEngine: mocks.getProjectEngine,
  projectMutationGeneration: mocks.projectMutationGeneration,
  listFiles: mocks.listFiles,
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

import { useFilesStore } from "@/store/files";
import { applyExternalFileChange } from "./external-file-changes";

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
  });
});
