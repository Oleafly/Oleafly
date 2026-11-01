// @vitest-environment jsdom

import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { DocumentEngineDescriptor } from "@/lib/tauri";
import type { ParsedBib } from "@/lib/citation/types";

const mocks = vi.hoisted(() => ({
  disk: {} as Record<string, string>,
  tree: [] as { path: string; is_dir: boolean }[],
}));

vi.mock("@/lib/tauri", () => ({
  projectManifestHome: async () => "library",
  projectMutationGeneration: async () => 1,
  listFiles: async () => mocks.tree,
  listFileTree: async () => ({ entries: mocks.tree, truncated: false }),
  readFileContent: async (_id: string, path: string) => mocks.disk[path] ?? "",
  writeFileContent: async (_id: string, path: string, content: string) => {
    mocks.disk[path] = content;
    return { path, generation: 1 };
  },
  mcpSetActiveProject: async () => {},
  appVersion: async () => "0.4.6",
}));
vi.mock("@/lib/cross-window", () => ({ notifyProjectFilesChanged: vi.fn() }));
vi.mock("@/store/project-index", () => ({
  useIndexStore: { getState: () => ({ index: null, texts: {}, rebuildFromDisk: async () => {} }) },
}));

import { editorText, renderStoreEditor, typeAtEnd } from "@/components/editor/test-editor-host";
import { useFilesStore } from "@/store/files";
import { addCitation, addCitations } from "./citation";
import { citeOleafly } from "./cite-oleafly";

const TYPST_ENGINE: DocumentEngineDescriptor = {
  ...LATEX_ENGINE,
  id: "typst",
  label: "Typst",
  source_format: "typst",
  main_document: "main.typ",
  source_extensions: ["typ"],
  capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "typst" },
};

const KNUTH = "@book{knuth1984,\n  title = {The TeXbook}\n}\n";
const LATEX_MAIN = "\\documentclass{article}\n\\begin{document}\n\\bibliography{refs}\n\\end{document}\n";

const ENTRY: ParsedBib = {
  key: "placeholder",
  type: "article",
  fields: { title: "Edge Sensing", author: "Ada Lovelace", year: "2024" },
};

async function openProject(
  engine: DocumentEngineDescriptor,
  mainDoc: string,
  activePath: string,
  files: Record<string, string>,
) {
  mocks.disk = { ...files };
  mocks.tree = Object.keys(files).map((path) => ({ path, is_dir: false }));
  useFilesStore.setState({
    projectId: "paper",
    projectName: "Paper",
    mainDoc,
    engine,
    engineLoaded: true,
    tree: mocks.tree,
    files: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, { content, dirty: false }])),
    openTabs: Object.keys(files),
    activePath,
  });
  renderStoreEditor();
  await act(async () => {});
}

async function typeAndSave(path: string, text: string): Promise<string> {
  typeAtEnd(text);
  await useFilesStore.getState().saveFile(path);
  return mocks.disk[path];
}

beforeEach(async () => {
  await useFilesStore.getState().closeProject();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
});

afterEach(async () => {
  await vi.dynamicImportSettled();
  vi.unstubAllGlobals();
});

describe("citation writes to the file open in the editor", () => {
  it("shows imported entries in the open bibliography and keeps them after the next keystroke", async () => {
    await openProject(LATEX_ENGINE, "main.tex", "refs.bib", { "main.tex": LATEX_MAIN, "refs.bib": KNUTH });

    const result = await addCitations([ENTRY]);

    expect(result).toMatchObject({ imported: 1, errors: [], bibPath: "refs.bib" });
    expect(editorText()).toBe(useFilesStore.getState().files["refs.bib"].content);
    const saved = await typeAndSave("refs.bib", "\n");
    expect(saved).toContain("Edge Sensing");
    expect(saved).toContain("knuth1984");
  });

  it("keeps the bibliography declaration it adds to the open main document", async () => {
    await openProject(TYPST_ENGINE, "main.typ", "main.typ", {
      "main.typ": "= Paper\n\nEdge sensing matters.\n",
      "refs.bib": "",
    });

    const result = await addCitation(
      "@article{fresh,\n  title = {Edge Sensing},\n  author = {Ada Lovelace},\n  year = {2024}\n}",
    );

    if (!("key" in result) || !result.cite) throw new Error(`citation was not inserted: ${JSON.stringify(result)}`);
    const main = useFilesStore.getState().files["main.typ"].content;
    expect(main).toContain('#bibliography("refs.bib")');
    expect(main).toContain(result.cite);
    expect(editorText()).toBe(main);
    const saved = await typeAndSave("main.typ", "\n");
    expect(saved).toContain('#bibliography("refs.bib")');
    expect(saved).toContain(result.cite);
  });

  it("shows the Oleafly entry in the open bibliography and keeps it after the next keystroke", async () => {
    await openProject(LATEX_ENGINE, "main.tex", "refs.bib", { "main.tex": LATEX_MAIN, "refs.bib": KNUTH });

    const outcome = await citeOleafly();

    expect(outcome).toMatchObject({ kind: "added", path: "refs.bib" });
    expect(editorText()).toBe(useFilesStore.getState().files["refs.bib"].content);
    const saved = await typeAndSave("refs.bib", "\n");
    expect(saved).toContain("@software{oleafly,");
    expect(saved).toContain("knuth1984");
  });
});
