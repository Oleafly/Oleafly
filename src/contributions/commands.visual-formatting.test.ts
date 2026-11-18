// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { WYSIWYG_EXTENSIONS, parseMarkdownBody, serializeMarkdownBody } from "@oleafly/wysiwyg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  state: {
    engine: null as unknown,
    engineLoaded: true,
    activePath: "README.md" as string | null,
    projectId: "p1" as string | null,
    manifestHome: null,
    tree: [],
  },
}));

vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.state } }));
vi.mock("@/features/export", () => ({ exportCurrentPdf: vi.fn() }));
vi.mock("@/features/synctex", () => ({ forwardFromCursor: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ clearBuildCache: vi.fn() }));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: vi.fn() } }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: vi.fn() } }));
vi.mock("@/store/citation", () => ({ useCitationStore: { getState: vi.fn() } }));

import { setEditorView } from "@/components/editor/cm/controller";
import { setWysiwygEditor, setWysiwygVisible } from "@/components/editor/wysiwyg/controller";
import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { runEngineFormatting } from "./commands";

const SOURCE = "First para.\n\nSecond para word.\n";

let view: EditorView;
let editor: Editor;

function select(word: string) {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at >= 0 || !node.isText || !node.text) return at < 0;
    const index = node.text.indexOf(word);
    if (index >= 0) at = pos + index;
    return false;
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at, at + word.length)));
}

const visual = () => serializeMarkdownBody(editor.getJSON());

beforeEach(async () => {
  mocks.state.engine = LATEX_ENGINE;
  mocks.state.projectId = "p1";
  await import("@/components/editor/markdown-model");
  view = new EditorView({ state: EditorState.create({ doc: SOURCE, selection: { anchor: 2 } }) });
  setEditorView(view);
  editor = new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, content: parseMarkdownBody(SOURCE).doc });
  setWysiwygEditor(editor);
  setWysiwygVisible(true);
  select("word");
});

afterEach(() => {
  setWysiwygVisible(false);
  setWysiwygEditor(null);
  setEditorView(null);
  editor.destroy();
  view.destroy();
  useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false });
});

describe("palette formatting in Visual mode", () => {
  it.each([
    ["bold", "First para.\n\nSecond para **word**."],
    ["italic", "First para.\n\nSecond para *word*."],
    ["section", "First para.\n\n# Second para word."],
    ["list", "First para.\n\n- Second para word."],
  ] as const)("runs %s on Visual's own selection and leaves the hidden source alone", async (action, expected) => {
    runEngineFormatting(action);
    await vi.waitFor(() => expect(visual()).toBe(expected));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.state.doc.toString()).toBe(SOURCE);
  });

  it.each([
    ["read-only in a shared project", () => useCollabEditorGate.setState({ projectId: "p1", viewer: false, locked: false })],
    ["locked for edits", () => editor.setEditable(false, false)],
  ])("does nothing while Visual is %s", async (_, lock) => {
    lock();
    for (const action of ["bold", "italic", "section", "list"] as const) runEngineFormatting(action);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(visual()).toBe("First para.\n\nSecond para word.");
    expect(view.state.doc.toString()).toBe(SOURCE);
  });
});
