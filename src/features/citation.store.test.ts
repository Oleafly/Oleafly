import { EditorState } from "@codemirror/state";
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
  replaceRange: vi.fn(),
  preferredCitationBibliography: vi.fn(),
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
  isWysiwygActive: () => false,
}));
vi.mock("@/store/settings", () => ({
  useSettingsStore: { getState: () => ({ offline: false }) },
}));
vi.mock("@/store/project-index", () => ({
  useIndexStore: {
    getState: () => ({ index: null, texts: {}, rebuildFromDisk: mocks.rebuildFromDisk }),
  },
}));
vi.mock("@/components/editor/cm/controller", () => ({
  getEditorView: mocks.getEditorView,
  insertAtCursor: mocks.insertAtCursor,
  replaceRange: mocks.replaceRange,
}));

vi.mock("./citation-bibliographies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./citation-bibliographies")>();
  mocks.preferredCitationBibliography.mockImplementation(actual.preferredCitationBibliography);
  return { ...actual, preferredCitationBibliography: mocks.preferredCitationBibliography };
});

import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import { addCitation, addCitations, bibliographyTargetForProject } from "./citation";

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
  for (const [name, fn] of Object.entries(mocks)) if (name !== "preferredCitationBibliography") fn.mockReset();
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

describe("a bibliography linked from outside the folder", () => {
  const ZOTERO = "@article{kept2020,\n  title = {Kept},\n  doi = {10.1000/kept}\n}\n";
  const LINKED_TREE = [
    { path: "main.tex", is_dir: false },
    { path: "refs.bib", is_dir: false, read_only: true },
  ];

  const useLinkedProject = (source: string, tree = LINKED_TREE) => {
    mocks.listFiles.mockImplementation(async () => tree);
    mocks.readFileContent.mockImplementation(async (_id: string, path: string) =>
      path === "refs.bib" ? ZOTERO : "",
    );
    mocks.getEditorView.mockReturnValue({ state: EditorState.create() });
    useFilesStore.setState({
      manifestHome: "folder",
      mainDoc: "main.tex",
      activePath: "main.tex",
      engine: LATEX_ENGINE,
      tree,
      files: {
        "main.tex": { content: source, dirty: false },
        "refs.bib": { content: ZOTERO, dirty: false },
      },
    });
  };

  it("imports nothing into it and says where the entries belong", async () => {
    useLinkedProject("\\bibliography{refs}\n");

    const result = await addCitations([ENTRY]);

    expect(result.imported).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("refs.bib");
    expect(result.errors[0]).toContain("Zotero");
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
    expect(useFilesStore.getState().files["refs.bib"]?.content).toBe(ZOTERO);
  });

  it("does not cite a new entry it could not store", async () => {
    useLinkedProject("\\bibliography{refs}\n");

    const result = await addCitation(
      "@article{fresh,\n  title = {Edge Sensing},\n  author = {Ada Lovelace},\n  year = {2024}\n}",
    );

    expect(result).toEqual({ error: expect.stringContaining("refs.bib") });
    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
  });

  it("still cites an entry the linked bibliography already holds", async () => {
    useLinkedProject("\\bibliography{refs}\n");

    const result = await addCitation("@article{fresh,\n  doi = {10.1000/kept}\n}");

    expect(result).toEqual({ key: "kept2020", cite: "\\cite{kept2020}" });
    expect(mocks.insertAtCursor).toHaveBeenCalledWith("\\cite{kept2020}");
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
  });

  it("adds a known entry to the cite list the caret is in", async () => {
    useLinkedProject("\\bibliography{refs}\n");
    const doc = "See \\cite{a,bo} now.";
    mocks.getEditorView.mockReturnValue({ state: EditorState.create({ doc, selection: { anchor: doc.indexOf("o}") } }) });

    const result = await addCitation("@article{fresh,\n  doi = {10.1000/kept}\n}");

    expect(result).toEqual({ key: "kept2020", cite: "kept2020" });
    expect(mocks.replaceRange).toHaveBeenCalledWith(doc.indexOf("}"), doc.indexOf("}"), ",kept2020");
    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
  });

  it("writes into a bibliography of its own when the document declares that one", async () => {
    const tree = [...LINKED_TREE, { path: "local.bib", is_dir: false }];
    useLinkedProject("\\addbibresource{local.bib}\n\\addbibresource{refs.bib}\n", tree);

    const result = await addCitations([ENTRY]);

    expect(result).toMatchObject({ imported: 1, errors: [], bibPath: "local.bib" });
    expect(mocks.writeFileContent.mock.calls.map((call) => call[1])).toEqual(["local.bib"]);
  });

  it("never falls back to creating a new bibliography next to the linked one", async () => {
    useLinkedProject("\\documentclass{article}\n");

    const result = await addCitations([ENTRY]);

    expect(result.errors[0]).toContain("refs.bib");
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
  });
});

describe("citation import failures", () => {
  it("names the project's bibliography and whether it exists yet", async () => {
    await expect(bibliographyTargetForProject()).resolves.toEqual({
      path: "references.bib",
      exists: false,
      content: "",
      readOnly: false,
    });

    useFilesStore.setState({ tree: FULL_TREE });
    await expect(bibliographyTargetForProject()).resolves.toMatchObject({ path: "references.bib", exists: true });

    useFilesStore.setState({ projectId: null });
    await expect(bibliographyTargetForProject()).resolves.toBeNull();
  });

  it("stops when the main document changes while it is being read", async () => {
    mocks.readFileContent.mockImplementation(async (_id: string, path: string) => {
      if (path === "paper.md") {
        useFilesStore.setState({ files: { "paper.md": { content: "# Edited\n", dirty: true } } });
      }
      return "# Paper\n";
    });

    const result = await addCitations([ENTRY]);

    expect(result.errors).toEqual([enCore.citation.fileChanged.replace("{{path}}", "paper.md")]);
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
  });

  it("reports a bibliography it could not write", async () => {
    mocks.writeFileContent.mockRejectedValue("disk full");

    const result = await addCitations([ENTRY]);

    expect(result).toMatchObject({ imported: 1, bibPath: "references.bib" });
    expect(result.errors).toEqual([
      enCore.citation.writeFailed.replace("{{path}}", "references.bib").replace("{{detail}}", "disk full"),
    ]);
    expect(mocks.rebuildFromDisk).not.toHaveBeenCalled();
  });

  it("still imports when the preferred bibliography cannot be chosen", async () => {
    mocks.preferredCitationBibliography.mockRejectedValueOnce(new Error("choices failed"));

    const result = await addCitations([ENTRY]);

    expect(result).toMatchObject({ imported: 1, errors: [], bibPath: "references.bib" });
    expect(mocks.logError).toHaveBeenCalledWith("choose citation bibliography", expect.any(Error));
  });

  it("does not cite or rebuild when another project opens during the import", async () => {
    mocks.writeFileContent.mockImplementation(async (_id: string, path: string) => {
      if (path === "paper.md") useFilesStore.setState({ projectId: "other" });
      return { path, generation: 9 };
    });

    const imported = await addCitations([ENTRY]);

    expect(imported.errors).toEqual([enCore.citation.projectChanged]);
    expect(mocks.rebuildFromDisk).not.toHaveBeenCalled();
  });

  it("does not insert a single citation when another project opens during the write", async () => {
    mocks.getEditorView.mockReturnValue({ state: EditorState.create() });
    mocks.writeFileContent.mockImplementation(async (_id: string, path: string) => {
      if (path === "paper.md") useFilesStore.setState({ projectId: "other" });
      return { path, generation: 9 };
    });

    const result = await addCitation("@article{fresh,\n  title = {Edge Sensing},\n  author = {Ada Lovelace},\n  year = {2024}\n}");

    expect(result).toEqual({ error: enCore.citation.projectChangedNotInserted });
    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
  });
});
