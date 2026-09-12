import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { DocumentEngineDescriptor } from "@/lib/tauri";
import type { ParsedBib } from "@/lib/citation/types";

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
  fetchDoiBibtex: vi.fn(),
  fetchArxiv: vi.fn(),
  crossrefSearch: vi.fn(),
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
  getEditorView: vi.fn(),
  insertAtCursor: vi.fn(),
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
  fetchDoiBibtex: mocks.fetchDoiBibtex,
  fetchArxiv: mocks.fetchArxiv,
  crossrefSearch: mocks.crossrefSearch,
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
vi.mock("@/store/settings", () => ({
  useSettingsStore: { getState: () => ({ offline: false }) },
}));
vi.mock("@/store/project-index", () => ({
  useIndexStore: {
    getState: () => ({ index: null, rebuildFromDisk: mocks.rebuildFromDisk }),
  },
}));
vi.mock("@/components/editor/cm/controller", () => ({
  getEditorView: mocks.getEditorView,
  insertAtCursor: mocks.insertAtCursor,
}));

import { useFilesStore } from "@/store/files";
import { addCitations } from "./citation";

const MARKDOWN_ENGINE: DocumentEngineDescriptor = {
  ...LATEX_ENGINE,
  id: "markdown",
  label: "Markdown",
  source_format: "markdown",
  main_document: "paper.md",
  source_extensions: ["md"],
  capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "markdown" },
};

const START_TREE = [{ path: "paper.md", is_dir: false }];
const FULL_TREE = [
  { path: "paper.md", is_dir: false },
  { path: "references.bib", is_dir: false },
];

const ENTRY: ParsedBib = {
  key: "placeholder",
  type: "article",
  fields: { title: "Edge Sensing", author: "Ada Lovelace", year: "2024" },
};

let refreshGate: Promise<void> | null = null;
let releaseRefresh: () => void = () => {};
let refreshCompletions = 0;
let treeAtRebuild: string[] = [];
let refreshesAtRebuild = 0;

function holdTreeListing() {
  refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = () => {
      refreshGate = null;
      resolve();
    };
  });
  return () => releaseRefresh();
}

beforeEach(async () => {
  await useFilesStore.getState().closeProject();
  for (const fn of Object.values(mocks)) fn.mockReset();
  refreshGate = null;
  refreshCompletions = 0;
  treeAtRebuild = [];
  refreshesAtRebuild = 0;
  mocks.projectMutationGeneration.mockResolvedValue(3);
  mocks.mcpSetActiveProject.mockResolvedValue(undefined);
  mocks.readFileContent.mockImplementation(async (_id: string, path: string) =>
    path === "paper.md" ? "# Paper\n" : "",
  );
  let nextGeneration = 9;
  mocks.writeFileContent.mockImplementation(async (_id: string, path: string) => {
    const generation = nextGeneration;
    nextGeneration += 3;
    return { path, generation };
  });
  mocks.listFiles.mockImplementation(async () => {
    if (refreshGate) await refreshGate;
    refreshCompletions++;
    return FULL_TREE;
  });
  mocks.rebuildFromDisk.mockImplementation(async () => {
    treeAtRebuild = useFilesStore.getState().tree.map((entry) => entry.path);
    refreshesAtRebuild = refreshCompletions;
  });
  useFilesStore.setState({
    projectId: "project",
    projectName: "Paper",
    mainDoc: "paper.md",
    engine: MARKDOWN_ENGINE,
    engineLoaded: true,
    tree: START_TREE,
    files: {},
    openTabs: [],
    activePath: null,
  });
});

describe("addCitations through the real writeProjectFile", () => {
  it("carries the generation each write returned into the next one", async () => {
    const result = await addCitations([ENTRY]);

    expect(result).toEqual({
      imported: 1,
      duplicates: 0,
      errors: [],
      bibPath: "references.bib",
    });
    expect(
      mocks.writeFileContent.mock.calls.map((call) => [call[1], call[3]]),
    ).toEqual([
      ["references.bib", 3],
      ["paper.md", 9],
    ]);
  });

  it("creates the bibliography without opening a tab for it", async () => {
    await addCitations([ENTRY]);

    const state = useFilesStore.getState();
    expect(state.tree.map((entry) => entry.path)).toContain("references.bib");
    expect(state.files["references.bib"]).toBeUndefined();
    expect(state.openTabs).toEqual([]);
    expect(state.activePath).toBeNull();
  });

  it("holds the rebuild and its own completion until the tree listing finishes", async () => {
    const release = holdTreeListing();
    let settled = false;
    const pending = addCitations([ENTRY]).then((value) => {
      settled = true;
      return value;
    });

    await vi.waitFor(() => {
      expect(mocks.listFiles).toHaveBeenCalled();
    });
    expect(mocks.rebuildFromDisk).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    expect(useFilesStore.getState().tree.map((entry) => entry.path)).not.toContain(
      "references.bib",
    );

    release();
    await pending;

    expect(settled).toBe(true);
    expect(treeAtRebuild).toContain("references.bib");
    expect(refreshesAtRebuild).toBe(2);
  });

  it("announces the written paths without naming a tab to open", async () => {
    await addCitations([ENTRY]);

    expect(mocks.notifyProjectFilesChanged.mock.calls).toEqual([
      ["project", ["references.bib"]],
      ["project", ["paper.md"]],
    ]);
  });
});

describe("LaTeX bibliography targeting", () => {
  const LATEX_TREE = [
    { path: "main.tex", is_dir: false },
    { path: "other.bib", is_dir: false },
    { path: "refs.bib", is_dir: false },
  ];

  const useLatexProject = (source: string) => {
    mocks.listFiles.mockImplementation(async () => LATEX_TREE);
    useFilesStore.setState({
      mainDoc: "main.tex",
      engine: LATEX_ENGINE,
      tree: LATEX_TREE,
      files: { "main.tex": { content: source, dirty: false } },
    });
  };

  it("writes into the declared bibliography, not the first one in the tree", async () => {
    useLatexProject("\\addbibresource[location=local]{refs.bib}\n");

    const result = await addCitations([ENTRY]);

    expect(result.bibPath).toBe("refs.bib");
    expect(mocks.writeFileContent.mock.calls.map((call) => call[1])).toEqual(["refs.bib"]);
  });

  it("writes into the bibliography a plain declaration names", async () => {
    useLatexProject("\\bibliography{refs}\n");

    expect((await addCitations([ENTRY])).bibPath).toBe("refs.bib");
  });

  it("falls back to the first bibliography when the project declares none", async () => {
    useLatexProject("\\documentclass{article}\n");

    expect((await addCitations([ENTRY])).bibPath).toBe("other.bib");
  });
});
