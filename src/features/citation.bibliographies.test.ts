import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { DocumentEngineDescriptor } from "@/lib/tauri";

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
    getState: () => ({ index: null, rebuildFromDisk: mocks.rebuildFromDisk }),
  },
}));
vi.mock("@/components/editor/cm/controller", () => ({
  getEditorView: mocks.getEditorView,
  insertAtCursor: mocks.insertAtCursor,
}));
const remembered = vi.hoisted(() => ({ rememberedBibliography: vi.fn() }));
vi.mock("@/lib/citation/bibliography-choices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/citation/bibliography-choices")>()),
  rememberedBibliography: remembered.rememberedBibliography,
}));

import { useFilesStore } from "@/store/files";
import { addCitation, addCitations } from "./citation";
import { parseEntry } from "@/lib/citation/bibtex";
import { citationBibliographyChoices } from "./citation-bibliographies";

const TYPST_ENGINE: DocumentEngineDescriptor = {
  ...LATEX_ENGINE,
  id: "typst",
  label: "Typst",
  source_format: "typst",
  main_document: "main.typ",
  source_extensions: ["typ"],
  capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "typst" },
};

const TREE = [
  { path: "main.typ", is_dir: false },
  { path: "chapters/two.typ", is_dir: false },
  { path: "primary.bib", is_dir: false },
  { path: "secondary.bib", is_dir: false },
  { path: "chapter.bib", is_dir: false },
  { path: "unused.bib", is_dir: false },
];

const MAIN = [
  '#bibliography("primary.bib", target: selector(cite).before(<two>))',
  '#include "chapters/two.typ"',
  '#bibliography("secondary.bib", target: selector(cite).after(<two>), group: none)',
].join("\n");

const ENTRY = "@article{fresh,\n  title = {Edge Sensing},\n  author = {Ada Lovelace},\n  year = {2024}\n}";

beforeEach(async () => {
  await useFilesStore.getState().closeProject();
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.projectMutationGeneration.mockResolvedValue(3);
  mocks.mcpSetActiveProject.mockResolvedValue(undefined);
  mocks.listFiles.mockResolvedValue(TREE);
  mocks.readFileContent.mockImplementation(async (_id: string, path: string) => (path === "main.typ" ? MAIN : ""));
  let nextGeneration = 9;
  mocks.writeFileContent.mockImplementation(async (_id: string, path: string) => {
    const generation = nextGeneration;
    nextGeneration += 3;
    return { path, generation };
  });
  mocks.getEditorView.mockReturnValue({ state: EditorState.create() });
  remembered.rememberedBibliography.mockReset().mockReturnValue(null);
  useFilesStore.setState({
    projectId: "project",
    projectName: "Thesis",
    mainDoc: "main.typ",
    engine: TYPST_ENGINE,
    engineLoaded: true,
    tree: TREE,
    files: {},
    openTabs: [],
    activePath: "main.typ",
  });
});

describe("citationBibliographyChoices", () => {
  it("lists the bibliographies the project declares", async () => {
    expect(await citationBibliographyChoices()).toEqual(["primary.bib", "secondary.bib"]);
  });

  it("includes bibliographies declared in open chapter files", async () => {
    useFilesStore.setState({
      files: { "chapters/two.typ": { content: '= Two <two>\n#bibliography("../chapter.bib")', dirty: false } },
    });
    expect(await citationBibliographyChoices()).toEqual(["primary.bib", "secondary.bib", "chapter.bib"]);
  });

  it("offers nothing for Markdown projects", async () => {
    useFilesStore.setState({
      engine: {
        ...TYPST_ENGINE,
        capabilities: { ...TYPST_ENGINE.capabilities, formatting_profile: "markdown" },
      },
    });
    expect(await citationBibliographyChoices()).toEqual([]);
  });
});

describe("addCitation with several bibliographies", () => {
  it("writes into the first declared bibliography by default", async () => {
    const result = await addCitation(ENTRY);
    expect(result).toEqual({ key: expect.any(String), cite: expect.stringMatching(/^@/u) });
    expect(mocks.writeFileContent.mock.calls.map((call) => call[1])).toEqual(["primary.bib"]);
  });

  it("writes into the bibliography the user picked", async () => {
    const result = await addCitation(ENTRY, { bibliography: "secondary.bib" });
    expect(result).toEqual({ key: expect.any(String), cite: expect.stringMatching(/^@/u) });
    expect(mocks.writeFileContent.mock.calls.map((call) => call[1])).toEqual(["secondary.bib"]);
    expect(mocks.writeFileContent.mock.calls[0]?.[2]).toContain("Edge Sensing");
    expect(mocks.insertAtCursor).toHaveBeenCalledWith(expect.stringMatching(/^@/u));
  });

  it("ignores a pick that is not a writable bibliography", async () => {
    await addCitation(ENTRY, { bibliography: "../outside.bib" });
    expect(mocks.writeFileContent.mock.calls.map((call) => call[1])).toEqual(["primary.bib"]);
  });
});

describe("addCitations with several bibliographies", () => {
  const library = () => [parseEntry(ENTRY)].flatMap((entry) => (entry ? [entry] : []));

  it("imports into the bibliography the project remembers", async () => {
    remembered.rememberedBibliography.mockReturnValue("secondary.bib");
    const result = await addCitations(library());
    expect(remembered.rememberedBibliography).toHaveBeenCalledWith("project");
    expect(result).toMatchObject({ imported: 1, errors: [], bibPath: "secondary.bib" });
    expect(mocks.writeFileContent.mock.calls.map((call) => call[1])).toEqual(["secondary.bib"]);
    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
  });

  it("falls back to the first declared bibliography without a usable remembered choice", async () => {
    remembered.rememberedBibliography.mockReturnValue("unused.bib");
    expect((await addCitations(library())).bibPath).toBe("primary.bib");
    remembered.rememberedBibliography.mockReturnValue(null);
    expect((await addCitations(library())).bibPath).toBe("primary.bib");
  });
});
