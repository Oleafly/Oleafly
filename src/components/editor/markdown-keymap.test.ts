// @vitest-environment jsdom

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { editorCommandKeymap, setEditorErrorReporter } from "@oleafly/editor";
import { WYSIWYG_EXTENSIONS, createMarkdownSourceSnapshot, parseMarkdownBody, serializeMarkdownBody } from "@oleafly/wysiwyg";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useEditorKeymapStore } from "@/store/editor-keymap";
import { markdownFormatKeymap } from "./markdown-keymap";
import { type MarkdownTarget, sourceTarget, visualTarget } from "./markdown-model";

const views: EditorView[] = [];

beforeAll(() => {
  if (!("getClientRects" in Range.prototype)) Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
});

afterEach(() => {
  vi.doUnmock("./markdown-model");
  setEditorErrorReporter(null);
  for (const view of views.splice(0)) view.destroy();
  useEditorKeymapStore.getState().resetAll();
  vi.restoreAllMocks();
});

function open(doc: string, word: string, extension = markdownFormatKeymap): EditorView {
  const from = doc.indexOf(word);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: from, head: from + word.length },
      extensions: [history(), extension, keymap.of(editorCommandKeymap(useEditorKeymapStore.getState().keys)), keymap.of([...defaultKeymap, ...historyKeymap])],
    }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

const SHIFTED: Record<string, [string, number]> = { b: ["B", 66], I: ["I", 73], U: ["U", 85], "7": ["&", 55], "8": ["*", 56] };

function press(view: EditorView, key: string, modifiers: { shift?: boolean; alt?: boolean; meta?: boolean } = {}) {
  const [typed, keyCode] = modifiers.shift && SHIFTED[key] ? SHIFTED[key] : [key, 0];
  const event = new KeyboardEvent("keydown", { key: typed, keyCode, ctrlKey: !modifiers.meta, metaKey: !!modifiers.meta, shiftKey: !!modifiers.shift, altKey: !!modifiers.alt, bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
}

async function pressed(doc: string, word: string, key: string, modifiers: { shift?: boolean; alt?: boolean; meta?: boolean } = {}): Promise<string> {
  const view = open(doc, word);
  press(view, key, modifiers);
  await import("./markdown-model");
  await new Promise((resolve) => setTimeout(resolve, 0));
  return view.state.doc.toString();
}

function viaToolbar(doc: string, word: string, act: (target: MarkdownTarget) => void): string {
  const view = open(doc, word, []);
  act(sourceTarget(() => view));
  return view.state.doc.toString();
}

describe("formatting shortcuts in a Markdown file", () => {
  it.each([
    ["b", false, "A **word** b.", "A word b."],
    ["i", false, "A word b.", "A *word* b."],
    ["e", false, "A word b.", "A `word` b."],
    ["s", true, "A word b.", "A ~~word~~ b."],
    [".", false, "A word b.", "A <sup>word</sup> b."],
    [",", true, "A word b.", "A <sub>word</sub> b."],
  ])("Ctrl %s (shift %s) makes the same edit as the toolbar", async (key, shift, doc, expected) => {
    expect(await pressed(doc, "word", key, { shift })).toBe(expected);
  });

  it("underlines with the Mod+U chord on a Mac, where Uppercase sits on Ctrl+U", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    expect(await pressed("A word b.", "word", "u")).toBe("A <u>word</u> b.");
  });

  it("leaves Ctrl+U to the Uppercase editor key on Windows and Linux", async () => {
    expect(await pressed("A word b.", "word", "u")).toBe("A WORD b.");
  });

  it("gives way to an editor key bound to the same chord", async () => {
    useEditorKeymapStore.getState().setKey("duplicate", "Mod-b");
    expect(await pressed("A word b.", "word", "b")).toBe("A wordword b.");
  });

  it.each([
    ["2", { alt: true }, (target: MarkdownTarget) => target.heading(2)],
    ["0", { alt: true }, (target: MarkdownTarget) => target.paragraph()],
    ["8", { shift: true }, (target: MarkdownTarget) => target.bullet()],
    ["7", { shift: true }, (target: MarkdownTarget) => target.ordered()],
    ["b", { shift: true }, (target: MarkdownTarget) => target.quote()],
    ["c", { alt: true }, (target: MarkdownTarget) => target.codeBlock()],
  ] as const)("Ctrl %s with %o does what Visual's shortcut does", async (key, modifiers, act) => {
    const doc = "## Alpha word beta\n\nNext.\n";
    expect(await pressed(doc, "word", key, modifiers)).toBe(viaToolbar(doc, "word", act));
    expect(viaToolbar(doc, "word", act)).not.toBe(doc);
  });

  it.each([
    ["a bullet item", "- one\n- two word\n\nNext.\n"],
    ["a numbered item", "1. one\n2. two word\n\nNext.\n"],
    ["a task item", "- [ ] task word\n\nNext.\n"],
  ])("bolds with Ctrl+Shift+B in %s, where a quote can't go, as Visual does", async (_name, doc) => {
    expect(await pressed(doc, "word", "b", { shift: true })).toBe(viaToolbar(doc, "word", (target) => target.bold()));
  });

  it("underlines with Mod+Shift+U on a Mac, as Visual does", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    expect(await pressed("A word b.", "word", "U", { shift: true })).toBe("A <u>word</u> b.");
  });

  it("applies two formatting keys pressed before the engine loads, one after the other", async () => {
    vi.resetModules();
    const fresh = await import("./markdown-keymap");
    const view = open("A word b.", "word", fresh.markdownFormatKeymap);
    press(view, "b");
    press(view, "i");
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe("A ***word*** b."), { timeout: 5000 });
  });

  it("formats what was selected when the key was pressed, even before the engine loads", async () => {
    vi.resetModules();
    const fresh = await import("./markdown-keymap");
    const view = open("A word b.", "word", fresh.markdownFormatKeymap);
    press(view, "b");
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe("A **word** b."), { timeout: 5000 });
  });

  it("italicizes with Ctrl+Shift+I, as Visual's Mod-I alias does", async () => {
    expect(await pressed("Alpha word beta.", "word", "I", { shift: true })).toBe("Alpha *word* beta.");
    expect(await pressed("- one\n- two word\n", "word", "I", { shift: true })).toBe("- one\n- two *word*\n");
  });

  it.each([
    ["a bullet item", "- one\n- two word\n\nNext.\n"],
    ["a numbered item", "1. one\n2. two word\n\nNext.\n"],
    ["a task item", "- [ ] task word\n\nNext.\n"],
  ])("stores Bold for the next key when Ctrl+Shift+B can't quote %s at a bare caret", async (_name, doc) => {
    const view = open(doc, "word");
    view.dispatch({ selection: { anchor: doc.indexOf("word") + 4 } });
    press(view, "b", { shift: true });
    await import("./markdown-model");
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const key of ["H", "i"]) view.dispatch({ ...view.state.replaceSelection(key), userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe(visualTyped(doc, "word", (target) => target.bold(), "Hi"));
  });

  it("drops the keys and reports the error when the engine chunk fails to load, then loads it on the next key", async () => {
    vi.resetModules();
    const errors: unknown[] = [];
    (await import("@oleafly/editor")).setEditorErrorReporter((_scope, error) => errors.push(error));
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("./markdown-model", () => {
      throw new Error("chunk failed");
    });
    const fresh = await import("./markdown-keymap");
    const view = open("A word b.", "word", fresh.markdownFormatKeymap);
    press(view, "b");
    press(view, "i");
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(view.state.doc.toString()).toBe("A word b.");
    vi.doUnmock("./markdown-model");
    press(view, "b");
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe("A **word** b."), { timeout: 5000 });
  });

  it("keeps a caret moved between two keys pressed before the engine loads", async () => {
    vi.resetModules();
    const fresh = await import("./markdown-keymap");
    const view = open("A word b.", "word", fresh.markdownFormatKeymap);
    press(view, "b");
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    press(view, "i");
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe("A **word** b."), { timeout: 5000 });
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    view.dispatch({ ...view.state.replaceSelection("X"), userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe("A **word** b.*X*");
  });

  it("types what was typed after a key pressed before the engine loads, through that key's mark", async () => {
    vi.resetModules();
    const fresh = await import("./markdown-keymap");
    const view = open("A word b.", "word", fresh.markdownFormatKeymap);
    press(view, "b");
    view.dispatch({ ...view.state.replaceSelection("X"), userEvent: "input.type" });
    view.dispatch({ ...view.state.replaceSelection("Y"), userEvent: "input.type" });
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe("A **XY** b."), { timeout: 5000 });
  });

  it("drops a key pressed before the engine loads when the file under it is replaced", async () => {
    vi.resetModules();
    const fresh = await import("./markdown-keymap");
    const view = open("A word b.", "word", fresh.markdownFormatKeymap);
    press(view, "b");
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "A word b." }, filter: false });
    await import("./markdown-model");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(view.state.doc.toString()).toBe("A word b.");
  });
});

function visualTyped(doc: string, word: string, act: (target: MarkdownTarget) => void, typed: string): string {
  const { doc: content, layout } = parseMarkdownBody(doc);
  const editor = new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, content });
  const snapshot = createMarkdownSourceSnapshot(layout, editor.getJSON());
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text?.includes(word)) at = pos + node.text.indexOf(word) + word.length;
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
  act(visualTarget(editor));
  for (const key of typed) editor.view.dispatch(editor.state.tr.insertText(key));
  const saved = serializeMarkdownBody(editor.getJSON(), snapshot);
  editor.destroy();
  return saved;
}
