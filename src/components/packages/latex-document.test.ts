import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";

const editor = vi.hoisted(() => {
  const view = {
    state: null as unknown as import("@codemirror/state").EditorState,
    dispatch: (spec: Parameters<import("@codemirror/state").EditorState["update"]>[0]) => {
      view.state = view.state.update(spec).state;
    },
  };
  return { view, getEditorView: vi.fn<() => typeof view | null>(() => view) };
});
vi.mock("@/components/editor/cm/controller", () => ({ getEditorView: editor.getEditorView }));

const files = vi.hoisted(() => ({
  state: {
    projectId: "paper" as string | null,
    activePath: "main.tex" as string | null,
    files: {} as Record<string, { content: string; dirty: boolean }>,
    setContent: vi.fn(() => true),
    saveFile: vi.fn(async () => {}),
    writeProjectFile: vi.fn(async () => {}),
  },
}));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => files.state } }));

const backend = vi.hoisted(() => ({ readFileContent: vi.fn(async () => "") }));
vi.mock("@/lib/tauri", () => backend);

const sources = vi.hoisted(() => ({ readDocumentSources: vi.fn() }));
vi.mock("@/lib/document-sources", () => sources);

const index = vi.hoisted(() => ({ value: { uses: [] } as unknown }));
vi.mock("@/store/project-index", () => ({ useIndexStore: { getState: () => ({ index: index.value }) } }));

const root = vi.hoisted(() => ({ resolveEffectiveMainDoc: vi.fn(() => ({ mainDoc: "main.tex" })) }));
vi.mock("@/lib/tex-root", () => root);

import { documentPackages, insertUsepackage, latexMainDocument } from "./latex-document";

const MAIN = "\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nHi\n\\end{document}\n";
const WITH_BOOKTABS =
  "\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage{booktabs}\n\\begin{document}\nHi\n\\end{document}\n";

beforeEach(() => {
  vi.clearAllMocks();
  editor.view.state = EditorState.create({ doc: MAIN, extensions: [history()] });
  editor.getEditorView.mockImplementation(() => editor.view);
  files.state.projectId = "paper";
  files.state.activePath = "main.tex";
  files.state.files = {};
  files.state.setContent.mockImplementation(() => true);
  backend.readFileContent.mockResolvedValue(MAIN);
});

describe("latexMainDocument", () => {
  it("follows the effective main document of the open project", () => {
    root.resolveEffectiveMainDoc.mockReturnValueOnce({ mainDoc: "thesis.tex" });
    expect(latexMainDocument()).toBe("thesis.tex");
    files.state.projectId = null;
    expect(latexMainDocument()).toBeNull();
  });
});

describe("documentPackages", () => {
  it("reads the main file and its inputs", async () => {
    sources.readDocumentSources.mockResolvedValue({
      paths: ["main.tex", "preamble.tex"],
      texts: [MAIN, "\\usepackage{xcolor}\n% \\usepackage{tikz}\n"],
      unreadable: [],
    });
    const loaded = await documentPackages("main.tex");
    expect(sources.readDocumentSources).toHaveBeenCalledWith("paper", index.value, "main.tex");
    expect([...loaded].sort()).toEqual(["amsmath", "xcolor"]);
  });
});

describe("insertUsepackage", () => {
  it("edits the open main file through the editor so undo removes it", async () => {
    expect(await insertUsepackage("main.tex", "booktabs", "")).toBe("editor");
    expect(editor.view.state.doc.toString()).toBe(WITH_BOOKTABS);
    undo({
      state: editor.view.state,
      dispatch: (transaction) => {
        editor.view.state = transaction.state;
      },
    });
    expect(editor.view.state.doc.toString()).toBe(MAIN);
    expect(files.state.writeProjectFile).not.toHaveBeenCalled();
  });

  it("updates a main file open in another tab and saves it", async () => {
    files.state.activePath = "chapter.tex";
    files.state.files = { "main.tex": { content: MAIN, dirty: false } };
    expect(await insertUsepackage("main.tex", "booktabs", "")).toBe("file");
    expect(files.state.setContent).toHaveBeenCalledWith("main.tex", WITH_BOOKTABS);
    expect(files.state.saveFile).toHaveBeenCalledWith("main.tex");
    expect(editor.view.state.doc.toString()).toBe(MAIN);
  });

  it("writes a main file that is not open", async () => {
    files.state.activePath = "refs.bib";
    expect(await insertUsepackage("main.tex", "geometry", "margin=1in")).toBe("file");
    expect(backend.readFileContent).toHaveBeenCalledWith("paper", "main.tex");
    expect(files.state.writeProjectFile).toHaveBeenCalledWith(
      "paper",
      "main.tex",
      MAIN.replace("{amsmath}\n", "{amsmath}\n\\usepackage[margin=1in]{geometry}\n"),
    );
  });

  it("changes nothing when the package is already there or there is no preamble", async () => {
    expect(await insertUsepackage("main.tex", "amsmath", "")).toBe("loaded");
    files.state.activePath = "notes.tex";
    backend.readFileContent.mockResolvedValue("Just notes\n");
    expect(await insertUsepackage("main.tex", "booktabs", "")).toBe("no-preamble");
    expect(files.state.writeProjectFile).not.toHaveBeenCalled();
    expect(editor.view.state.doc.toString()).toBe(MAIN);
  });
});
