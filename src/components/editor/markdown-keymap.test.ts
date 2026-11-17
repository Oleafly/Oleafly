// @vitest-environment jsdom

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { editorCommandKeymap } from "@oleafly/editor";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useEditorKeymapStore } from "@/store/editor-keymap";
import { markdownFormatKeymap } from "./markdown-keymap";
import { type MarkdownTarget, sourceTarget } from "./markdown-model";

const views: EditorView[] = [];

beforeAll(() => {
  if (!("getClientRects" in Range.prototype)) Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
});

afterEach(() => {
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

const SHIFTED: Record<string, [string, number]> = { b: ["B", 66], U: ["U", 85], "7": ["&", 55], "8": ["*", 56] };

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
});
