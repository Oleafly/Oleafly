// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { WYSIWYG_EXTENSIONS, parseMarkdownBody, serializeMarkdownBody } from "@oleafly/wysiwyg";
import { registry, type AppContext } from "@oleafly/registry";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { type HomePage, useHomeViewStore } from "@/store/home-view";

const mocks = vi.hoisted(() => ({
  state: {
    engine: null as unknown,
    engineLoaded: true,
    activePath: "main.tex" as string | null,
    projectId: "p1" as string | null,
    projectKind: "document",
    manifestHome: null,
    tree: [],
    files: {},
    mainDoc: null,
  },
}));

vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.state } }));
vi.mock("@/features/export", () => ({ exportCurrentPdf: vi.fn() }));
vi.mock("@/features/synctex", () => ({ forwardFromCursor: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ clearBuildCache: vi.fn() }));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: () => ({ notes: true, latexTools: true }) } }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: vi.fn() } }));
vi.mock("@/store/citation", () => ({ useCitationStore: { getState: () => ({ setOpen: vi.fn() }) } }));

import "@/components/notes/tests/setup";
import { setEditorView } from "@/components/editor/cm/controller";
import { setWysiwygEditor, setWysiwygVisible } from "@/components/editor/wysiwyg/controller";
import { registerNoteEditor } from "@/lib/open-note-editors";
import { noteEditorHandle } from "@/lib/tests/open-note-editor-fixtures";
import { engineFormattingAvailable, registerPaletteCommands, runEngineFormatting } from "./commands";

const SOURCE = "First para.\n\nSecond para word.\n";
const CTX: AppContext = { projectId: "p1", projectKind: "document", theme: "light", activeDocumentPath: "main.tex", latexToolsEnabled: true };
const ACTIONS = ["bold", "italic", "section", "list"] as const;
const EDITING = [
  "palette.figure",
  "palette.table",
  "palette.equation",
  "palette.label",
  "palette.close-environment",
  "palette.surround-environment",
  "palette.editor-uppercase",
  "palette.editor-lowercase",
  "palette.editor-titleCase",
  "palette.editor-duplicate",
  "palette.editor-deleteLine",
  "palette.insert-file-link",
  "palette.add-citation",
];

let view: EditorView;
let visual: Editor;
const disposers: (() => void)[] = [];

function select(editor: Editor, word: string) {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at >= 0 || !node.isText || !node.text) return at < 0;
    const index = node.text.indexOf(word);
    if (index >= 0) at = pos + index;
    return false;
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at, at + word.length)));
}

function tiptap(source: string): Editor {
  const editor = new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, content: parseMarkdownBody(source).doc });
  disposers.push(() => editor.destroy());
  return editor;
}

function openNote(source: string): Editor {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = new Editor({ element: root, extensions: WYSIWYG_EXTENSIONS, content: parseMarkdownBody(source).doc });
  disposers.push(registerNoteEditor("n1", noteEditorHandle({ editor, root })), () => editor.destroy(), () => root.remove());
  return editor;
}

function focusPalette() {
  const dialog = document.createElement("div");
  dialog.setAttribute("cmdk-dialog", "");
  const input = document.createElement("input");
  dialog.append(input);
  document.body.append(dialog);
  disposers.push(() => dialog.remove());
  input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}

function command(id: string) {
  const found = registry.commands.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const text = (editor: Editor) => serializeMarkdownBody(editor.getJSON());

beforeAll(() => {
  registerPaletteCommands();
});

beforeEach(async () => {
  mocks.state.engine = LATEX_ENGINE;
  mocks.state.activePath = "main.tex";
  await import("@/components/editor/markdown-model");
  view = new EditorView({ state: EditorState.create({ doc: SOURCE, selection: { anchor: 2 } }) });
  setEditorView(view);
  visual = tiptap(SOURCE);
  select(visual, "word");
});

afterEach(() => {
  setWysiwygVisible(false);
  setWysiwygEditor(null);
  setEditorView(null);
  view.destroy();
  for (const dispose of disposers.splice(0).reverse()) dispose();
  useHomeViewStore.setState({ page: "library" });
});

describe("the palette under a page that covers the project", { timeout: 60_000 }, () => {
  it.each<HomePage>(["diagram-composer", "generators", "symbols", "notes"])(
    "leaves the hidden Code editor alone under %s",
    async (page) => {
      mocks.state.activePath = "README.md";
      useHomeViewStore.setState({ page });
      expect(engineFormattingAvailable()).toBe(false);
      for (const action of ACTIONS) runEngineFormatting(action);
      await settle();
      expect(view.state.doc.toString()).toBe(SOURCE);
    },
  );

  it.each<HomePage>(["diagram-composer", "notes"])("leaves the hidden Visual editor alone under %s", async (page) => {
    mocks.state.activePath = "README.md";
    setWysiwygEditor(visual);
    setWysiwygVisible(true);
    useHomeViewStore.setState({ page });
    for (const action of ACTIONS) runEngineFormatting(action);
    await settle();
    expect(text(visual)).toBe("First para.\n\nSecond para word.");
  });

  it.each<HomePage>(["diagram-composer", "notes"])("hides every command that edits the hidden LaTeX editor under %s", (page) => {
    for (const id of [...EDITING, "palette.bold", "palette.italic", "palette.section", "palette.list"]) {
      expect(command(id).when?.(CTX) ?? true, `${id} on the project`).toBe(true);
    }
    useHomeViewStore.setState({ page });
    for (const id of [...EDITING, "palette.bold", "palette.italic", "palette.section", "palette.list"]) {
      expect(command(id).when?.(CTX) ?? true, `${id} under ${page}`).toBe(false);
    }
    for (const id of EDITING) command(id).run(CTX);
    expect(view.state.doc.toString()).toBe(SOURCE);
  });

  it.each([
    ["bold", "Note **word** here."],
    ["italic", "Note *word* here."],
    ["section", "# Note word here."],
    ["list", "- Note word here."],
  ] as const)("runs %s on the note the user was writing in", async (action, expected) => {
    mocks.state.activePath = "README.md";
    setWysiwygEditor(visual);
    setWysiwygVisible(true);
    useHomeViewStore.setState({ page: "notes" });
    const note = openNote("Note word here.\n");
    select(note, "word");
    note.view.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    focusPalette();
    expect(engineFormattingAvailable()).toBe(true);
    runEngineFormatting(action);
    await vi.waitFor(() => expect(text(note)).toBe(expected));
    expect(text(visual)).toBe("First para.\n\nSecond para word.");
    expect(view.state.doc.toString()).toBe(SOURCE);
  });

  it("offers nothing on Notes once the focus has left the note", async () => {
    useHomeViewStore.setState({ page: "notes" });
    const note = openNote("Note word here.\n");
    select(note, "word");
    note.view.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const search = document.createElement("input");
    document.body.append(search);
    disposers.push(() => search.remove());
    search.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    focusPalette();
    expect(engineFormattingAvailable()).toBe(false);
    runEngineFormatting("bold");
    await settle();
    expect(text(note)).toBe("Note word here.");
  });

  it("leaves a read-only note alone", async () => {
    useHomeViewStore.setState({ page: "notes" });
    const note = openNote("Note word here.\n");
    select(note, "word");
    note.setEditable(false, false);
    note.view.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    focusPalette();
    expect(engineFormattingAvailable()).toBe(false);
    runEngineFormatting("bold");
    await settle();
    expect(text(note)).toBe("Note word here.");
  });
});

const SOURCE_ONLY = ["palette.editor-uppercase", "palette.editor-lowercase", "palette.editor-titleCase", "palette.editor-duplicate", "palette.editor-deleteLine"];

function openDialog(): HTMLInputElement {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const field = document.createElement("input");
  dialog.append(field);
  document.body.append(dialog);
  disposers.push(() => dialog.remove());
  field.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  return field;
}

describe("the palette with Visual in front of the Code editor", { timeout: 60_000 }, () => {
  it("hides the line and case commands and leaves Code's text alone", () => {
    mocks.state.activePath = "README.md";
    setWysiwygEditor(visual);
    setWysiwygVisible(true);
    for (const id of SOURCE_ONLY) {
      expect(command(id).when?.(CTX) ?? true, id).toBe(false);
      command(id).run(CTX);
    }
    expect(view.state.doc.toString()).toBe(SOURCE);
    expect(text(visual)).toBe("First para.\n\nSecond para word.");
    setWysiwygVisible(false);
    for (const id of SOURCE_ONLY) expect(command(id).when?.(CTX) ?? true, `${id} in Code`).toBe(true);
  });
});

describe("the palette over a dialog", { timeout: 60_000 }, () => {
  it("formats nothing and offers no editing command while a dialog is in front of the project, and offers them again once it closes", async () => {
    mocks.state.activePath = "README.md";
    setWysiwygEditor(visual);
    setWysiwygVisible(true);
    const field = openDialog();
    focusPalette();
    expect(engineFormattingAvailable()).toBe(false);
    for (const id of ["palette.bold", "palette.list", "palette.add-citation", ...SOURCE_ONLY]) expect(command(id).when?.(CTX) ?? true, id).toBe(false);
    for (const action of ACTIONS) runEngineFormatting(action);
    await settle();
    expect(text(visual)).toBe("First para.\n\nSecond para word.");
    expect(view.state.doc.toString()).toBe(SOURCE);
    field.closest('[role="dialog"]')?.remove();
    expect(engineFormattingAvailable()).toBe(true);
  });
});

describe("the palette with a note tab in front of the project", { timeout: 60_000 }, () => {
  it.each([
    ["bold", "Note **word** here."],
    ["list", "- Note word here."],
  ] as const)("runs %s on the note the user is writing in", async (action, expected) => {
    mocks.state.activePath = "README.md";
    setEditorView(null);
    const note = openNote("Note word here.\n");
    select(note, "word");
    note.view.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    focusPalette();
    expect(engineFormattingAvailable()).toBe(true);
    runEngineFormatting(action);
    await vi.waitFor(() => expect(text(note)).toBe(expected));
  });

  it("offers no formatting or editing command when no editor is in front", () => {
    mocks.state.activePath = "README.md";
    setEditorView(null);
    focusPalette();
    expect(engineFormattingAvailable()).toBe(false);
    for (const id of ["palette.bold", "palette.figure", ...SOURCE_ONLY]) expect(command(id).when?.(CTX) ?? true, id).toBe(false);
  });

  it("leaves a note behind the covered project alone", async () => {
    mocks.state.activePath = "README.md";
    const note = openNote("Note word here.\n");
    note.view.dom.parentElement?.setAttribute("inert", "");
    select(note, "word");
    note.view.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    focusPalette();
    runEngineFormatting("bold");
    await settle();
    expect(text(note)).toBe("Note word here.");
  });
});
