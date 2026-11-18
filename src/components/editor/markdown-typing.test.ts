// @vitest-environment jsdom

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, redo, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { WYSIWYG_EXTENSIONS, createMarkdownSourceSnapshot, parseMarkdownBody, serializeMarkdownBody } from "@oleafly/wysiwyg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { markdownFormatKeymap } from "./markdown-keymap";
import { type MarkdownTarget, sourceTarget, visualTarget } from "./markdown-model";
import { shareParsingDocument } from "./tests/markdown-toolbar-corpus";

type Act = (target: MarkdownTarget) => void;
type Key = string | { press: "Backspace" | "Delete" | "Enter" } | { cut: true } | { paste: string };

const opened: { destroy: () => void }[] = [];
const hostTools = new Compartment();
let restoreParsing: () => void = () => {};

afterAll(() => restoreParsing());

beforeAll(() => {
  restoreParsing = shareParsingDocument();
  if (!("ClipboardEvent" in globalThis)) Object.defineProperty(globalThis, "ClipboardEvent", { configurable: true, value: class extends Event {} });
  if (!("getClientRects" in Range.prototype)) Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
});

afterEach(() => {
  for (const item of opened.splice(0)) item.destroy();
});

function marked(source: string): { doc: string; anchor: number; head: number } {
  const open = source.indexOf("⟦");
  if (open >= 0) {
    const close = source.indexOf("⟧");
    return { doc: source.replace("⟦", "").replace("⟧", ""), anchor: open, head: close - 1 };
  }
  const at = source.indexOf("|");
  return { doc: source.slice(0, at) + source.slice(at + 1), anchor: at, head: at };
}

function codeView(source: string, brackets = false): EditorView {
  const { doc, anchor, head } = marked(source);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [
        history(),
        markdown(),
        markdownFormatKeymap,
        hostTools.of([]),
        ...(brackets ? [closeBrackets()] : []),
        keymap.of([...(brackets ? closeBracketsKeymap : []), ...defaultKeymap, ...historyKeymap]),
      ],
    }),
    parent: document.body,
  });
  opened.push(view);
  return view;
}

function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function codeKey(view: EditorView, key: Key) {
  if (typeof key === "string") {
    const { from, to } = view.state.selection.main;
    const insert = () => view.state.update({ changes: { from, to, insert: key }, selection: { anchor: from + key.length }, userEvent: "input.type" });
    if (!view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, key, insert))) view.dispatch(insert());
  } else if ("press" in key) {
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: key.press, bubbles: true, cancelable: true }));
  } else if ("cut" in key) {
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: "delete.cut" });
  } else {
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to, insert: key.paste }, selection: { anchor: from + key.paste.length }, userEvent: "input.paste" });
  }
}

function inCode(source: string, acts: Act[], keys: Key[], brackets = false): string {
  const view = codeView(source, brackets);
  for (const act of acts) act(sourceTarget(() => view));
  for (const key of keys) codeKey(view, key);
  return view.state.doc.toString();
}

function sourceToModel(editor: Editor, source: string, offset: number): number {
  const mark = "";
  const parsed = parseMarkdownBody(source.slice(0, offset) + mark + source.slice(offset));
  const doc = editor.schema.nodeFromJSON(parsed.doc);
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText || !node.text) return found < 0;
    const at = node.text.indexOf(mark);
    if (at >= 0) found = pos + at;
    return false;
  });
  if (found < 0) throw new Error(`no model position for ${offset}`);
  return found;
}

function visualKey(editor: Editor, key: Key) {
  const { view } = editor;
  if (typeof key === "string") {
    const { from, to } = view.state.selection;
    if (!view.someProp("handleTextInput", (handle) => handle(view, from, to, key, () => view.state.tr.insertText(key, from, to)))) view.dispatch(view.state.tr.insertText(key));
  } else if ("press" in key) view.someProp("handleKeyDown", (handle) => handle(view, new KeyboardEvent("keydown", { key: key.press })));
  else if ("cut" in key) view.dispatch(view.state.tr.deleteSelection());
  else view.pasteText(key.paste);
}

function inVisual(source: string, acts: Act[], keys: Key[], at?: { anchor: number; head: number }): string {
  const { doc, anchor, head } = marked(source);
  const { doc: content, frontmatter, layout } = parseMarkdownBody(doc);
  const editor = new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, content });
  opened.push(editor);
  const snapshot = createMarkdownSourceSnapshot(layout, editor.getJSON());
  const from = at?.anchor ?? sourceToModel(editor, doc, anchor);
  const to = at?.head ?? (head === anchor ? from : sourceToModel(editor, doc, head));
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
  for (const act of acts) act(visualTarget(editor));
  for (const key of keys) visualKey(editor, key);
  return frontmatter + serializeMarkdownBody(editor.getJSON(), snapshot);
}

const bold: Act = (target) => target.bold();
const italic: Act = (target) => target.italic();
const strike: Act = (target) => target.strike();
const code: Act = (target) => target.code();
const underline: Act = (target) => target.underline();
const highlight: Act = (target) => target.highlight();
const sup: Act = (target) => target.superscript();
const sub: Act = (target) => target.subscript();
const teal: Act = (target) => target.color("teal");

const center: Act = (target) => target.align("center");

describe("typing after a mark at a bare caret", () => {
  it.each<[string, string, Act[], Key[]]>([
    ["Underline, then a word sharing the tag's letters", "Alpha bra|vo charlie.\n", [underline], ["u", "n", "d", "e", "r"]],
    ["Highlight, then 'and'", "Alpha bra|vo charlie.\n", [highlight], ["a", "n", "d"]],
    ["Superscript, then 'sun'", "Alpha bra|vo charlie.\n", [sup], ["s", "u", "n"]],
    ["Subscript, then 'sub'", "Alpha bra|vo charlie.\n", [sub], ["s", "u", "b"]],
    ["Teal, then 'the'", "Alpha bra|vo charlie.\n", [teal], ["t", "h", "e"]],
    ["Teal, then '(Hi'", "Alpha bra|vo charlie.\n", [teal], ["(", "H", "i"]],
    ["Bold, then '<x'", "Alpha bra|vo charlie.\n", [bold], ["<", "x"]],
    ["Bold, then '>x'", "Alpha bra|vo charlie.\n", [bold], [">", "x"]],
    ["Code, then '`x'", "Alpha bra|vo charlie.\n", [code], ["`", "x"]],
    ["Bold, then a space and 'Hi'", "Alpha bravo| charlie.\n", [bold], [" ", "H", "i"]],
    ["Bold mid-word, then a space and 'x'", "Alpha bra|vo charlie.\n", [bold], [" ", "x"]],
    ["Bold, then '$x'", "Alpha bra|vo charlie.\n", [bold], ["$", "x"]],
    ["Italic, then '$x'", "Alpha bra|vo charlie.\n", [italic], ["$", "x"]],
    ["Bold, then a quoted word", "Alpha bravo| charlie.\n", [bold], ['"', "H", "i", '"']],
    ["Italic, then a quoted word", "Alpha bravo| charlie.\n", [italic], ['"', "H", "i", '"']],
    ["Bold at a word start, then '(Hi'", "Alpha |bravo charlie.\n", [bold], ["(", "H", "i"]],
    ["Bold, then '.Hi'", "Alpha bravo| charlie.\n", [bold], [".", "H", "i"]],
    ["Bold at a line start, then '# x'", "|bravo charlie.\n", [bold], ["#", " ", "x"]],
    ["Bold at a line start, then '- x'", "|bravo charlie.\n", [bold], ["-", " ", "x"]],
    ["Bold at a line start, then '1. x'", "|bravo charlie.\n", [bold], ["1", ".", " ", "x"]],
    ["Bold twice", "Alpha bra|vo charlie.\n", [bold, bold], ["H", "i"]],
    ["Bold, then Italic", "Alpha bra|vo charlie.\n", [bold, italic], ["H", "i"]],
    ["Bold, then Underline", "Alpha bra|vo charlie.\n", [bold, underline], ["H", "i"]],
    ["Bold in an empty heading", "## |\n", [bold], ["H", "i"]],
    ["Bold, then Enter in a list item", "- one bravo|\n", [bold], [{ press: "Enter" }, "H", "i"]],
  ])("types what Visual types after %s", (_name, source, acts, keys) => {
    expect(inCode(source, acts, keys)).toBe(inVisual(source, acts, keys));
  }, 30_000);

  it("leaves the caret after the typed letter, inside the new tags", () => {
    const view = codeView("Alpha bra|vo charlie.\n");
    underline(sourceTarget(() => view));
    codeKey(view, "u");
    expect(view.state.doc.toString()).toBe("Alpha bra<u>u</u>vo charlie.\n");
    expect(view.state.selection.main.head).toBe("Alpha bra<u>u".length);
  });

  it.each([
    ["a '*' list", "* one\n* |two\n", "* one\n* **H**two\n"],
    ["a '+' list", "+ one\n+ |two\n", "+ one\n+ **H**two\n"],
    ["a '1)' list", "1) one\n2) |two\n", "1) one\n2) **H**two\n"],
    ["the end of a '*' item", "* one|\n* two\n", "* one**H**\n* two\n"],
    ["the end of a callout", "::: {.callout-note}\nNote and word.|\n:::\n", "::: {.callout-note}\nNote and word.**H**\n:::\n"],
    ["the start of a callout", "::: {.callout-note}\n|Note and word.\n:::\n", "::: {.callout-note}\n**H**Note and word.\n:::\n"],
    ["a soft-wrapped line start", "Line one wraps\n|here and more.\n", "Line one wraps\n**H**here and more.\n"],
    ["a quote's second line", "> line one\n> |line two\n", "> line one\n> **H**line two\n"],
    ["an entity", "Caf&eacute;| end.\n", "Caf&eacute;**H** end.\n"],
    ["a two-space break", "Line one  \nline| two.\n", "Line one  \nline**H** two.\n"],
    ["a reference link", "See [x][r]| end.\n\n[r]: https://a.b\n", "See [x][r]**H** end.\n\n[r]: https://a.b\n"],
    ["an autolink", "See <https://a.b>| end.\n", "See <https://a.b>**H** end.\n"],
    ["column 0 of a setext heading", "Intro.\n\n|zacaa zacab\n-----------\n\nAfter.\n", "Intro.\n\n**X**zacaa zacab\n-----------\n\nAfter.\n"],
  ])("only inserts the typed letter and its mark after Bold at %s", (_name, source, expected) => {
    const key = expected.includes("**X**") ? "X" : "H";
    expect(inCode(source, [bold], [key])).toBe(expected);
  });
});

describe("the first key after a mark over a selection", () => {
  const marks: [string, Act][] = [["Bold", bold], ["Italic", italic], ["Strike", strike], ["Code", code], ["Underline", underline], ["Highlight", highlight], ["Teal", teal]];
  const deletes: [string, Key][] = [["Backspace", { press: "Backspace" }], ["Delete", { press: "Delete" }], ["Cut", { cut: true }]];

  it.each(marks.flatMap(([mark, act]) => deletes.map(([name, key]) => [mark, name, act, key] as const)))("leaves no empty delimiters after %s, then %s", (_mark, _name, act, key) => {
    expect(inCode("Alpha ⟦bravo⟧ charlie.\n", [act], [key])).toBe("Alpha  charlie.\n");
  });

  it.each([["Bold", bold], ["Italic", italic]] as const)("types plainly after %s, then Backspace, as Visual does", (_name, act) => {
    const keys: Key[] = [{ press: "Backspace" }, "H", "i"];
    expect(inCode("Alpha ⟦bravo⟧ charlie.\n", [act], keys)).toBe(inVisual("Alpha ⟦bravo⟧ charlie.\n", [act], keys));
  });

  it("splits the paragraph with Enter as Visual does", () => {
    const keys: Key[] = [{ press: "Enter" }, "H", "i"];
    expect(inCode("Alpha ⟦bravo⟧ charlie.\n", [bold], keys)).toBe(inVisual("Alpha ⟦bravo⟧ charlie.\n", [bold], keys));
  });

  it("pastes plain text over the formatted word, as Visual does", () => {
    expect(inCode("Alpha ⟦bravo⟧ charlie.\n", [bold], [{ paste: "Hi" }])).toBe(inVisual("Alpha ⟦bravo⟧ charlie.\n", [bold], [{ paste: "Hi" }]));
  });

  it.each<[string, string, Act, Key[]]>([
    ["Backspace after Center over a paragraph and a fenced block", "Alpha zctq ⟦zcuq.\n\n```\nzcvq⟧ zcwq code\n```\n", center, [{ press: "Backspace" }]],
    ["Backspace after Bold over a paragraph and a fenced block", "Alpha zctq ⟦zcuq.\n\n```\nzcvq⟧ zcwq code\n```\n", bold, [{ press: "Backspace" }]],
    ["typing after Bold from a paragraph into a list", "Para zr⟦ja text.\n\n- zr⟧ka one\n- zrla two\n", bold, ["X"]],
  ])("does what Visual does for %s", (_name, source, act, keys) => {
    expect(inCode(source, [act], keys)).toBe(inVisual(source, [act], keys));
  });
});

describe("the first key after an action that changes nothing", () => {
  const paragraph: Act = (target) => target.paragraph();
  const left: Act = (target) => target.align("left");
  const quote: Act = (target) => target.quote();

  it.each<[string, string, Act, string]>([
    ["Quote at column 0 of a list item", "Para.\n\n- zarq one\n|- zasq two\n", quote, "Para.\n\n- zarq one\n- Xzasq two\n"],
    ["Left at the end of a closing fence", "```python\nprint(1)\n```|\n\nAfter.\n", left, "```python\nprint(1)X\n```\n\nAfter.\n"],
    ["Paragraph inside a footnote reference", "A note[^n|] here.\n\n[^n]: The note.\n", paragraph, "A note[^n]X here.\n\n[^n]: The note.\n"],
    ["Left at column 0 of a heading", "Intro.\n\n|### zafq here\n", left, "Intro.\n\n### Xzafq here\n"],
  ])("types the first key where Visual's caret is after a no-op %s", (_name, source, act, expected) => {
    expect(inCode(source, [act], ["X"])).toBe(expected);
  });

  it.each<[string, string, Act]>([
    ["Paragraph from bold text into a quote", "- zasq **za⟦tq**\n\n> za⟧uq\n", paragraph],
    ["H2 from a setext heading into a task list", "zahq za⟦iq\n---\n\n- [ ] za⟧jq zakq\n- [x] zalq\n", (target) => target.heading(2)],
  ])("types over a no-op %s as Visual does", (_name, source, act) => {
    expect(inCode(source, [act], ["X"])).toBe(inVisual(source, [act], ["X"]));
  });

  it("closes the fenced block after a no-op Left from it into a list, then typing, and keeps the list's own markers", () => {
    const source = "Intro.\n\n```bash\nnpm i zb⟦dq\n```\n\n* zb⟧eq star item\n* zbfq second\n";
    expect(inVisual(source, [left], ["X"])).toBe("Intro.\n\n```bash\nnpm i zbXeq star item\n```\n\n- zbfq second\n");
    expect(inCode(source, [left], ["X"])).toBe("Intro.\n\n```bash\nnpm i zbXeq star item\n```\n\n* zbfq second\n");
  });

  it("keeps the reference definitions after Center from a fenced block into a list, then typing", () => {
    const source = "See [x][g].\n\n```bash\nnpm i zb⟦dq\n```\n\n* zbeq star item\n* zb⟧fq second\n\n[g]: https://g.example\n";
    const typed = inCode(source, [center], ["X"]);
    expect(typed).toContain("[g]: https://g.example\n");
    expect(typed).toBe(inVisual(source, [center], ["X"]));
  });
});

describe("keys that are not plain letters after a mark at a bare caret", () => {
  it.each<[string, string, Key[]]>([
    ["at the end of a word", "Alpha bravo| charlie.\n", ["(", "a", "b", ")"]],
    ["at the end of a word, with square brackets", "Alpha bravo| charlie.\n", ["[", "x", "]"]],
    ["inside a word", "Alpha bra|vo charlie.\n", ["(", "a", "b", ")"]],
  ])("keeps Bold through auto-closed brackets typed %s, as Visual does", (_name, source, keys) => {
    expect(inCode(source, [bold], keys, true)).toBe(inVisual(source, [bold], keys));
  });

  it.each([
    ["a heading", "## Head bravo|\n", "## Head bravo\n**Hi**\n"],
    ["a paragraph", "Alpha bravo| charlie.\n", "Alpha bravo\n**Hi**charlie.\n"],
  ])("keeps Bold through Enter at the end of %s", (_name, source, expected) => {
    expect(inCode(source, [bold], [{ press: "Enter" }, "H", "i"])).toBe(expected);
  });

  it.each([
    ["after a paragraph", "Para one.\n\n|", "Para one.\n\n**Hi**"],
    ["between two paragraphs", "Para one.\n\n|\n\nPara two.\n", "Para one.\n\n**Hi**\n\nPara two.\n"],
  ])("types into a new paragraph after Bold on the blank line %s", (_name, source, expected) => {
    expect(inCode(source, [bold], ["H", "i"])).toBe(expected);
  });

  it("types Bold after composed input ends", async () => {
    const view = codeView("Alpha bra|vo charlie.\n");
    await settled();
    bold(sourceTarget(() => view));
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    view.dispatch({ changes: { from: 9, insert: "X" }, selection: { anchor: 10 }, userEvent: "input.type.compose" });
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "X" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    codeKey(view, "Y");
    expect(view.state.doc.toString()).toBe("Alpha bra**XY**vo charlie.\n");
  });

  it("keeps the stored mark through a click on the same spot", () => {
    const view = codeView("Alpha bra|vo charlie.\n");
    bold(sourceTarget(() => view));
    view.dispatch({ selection: { anchor: 9 }, userEvent: "select.pointer" });
    for (const key of ["H", "i"]) codeKey(view, key);
    expect(view.state.doc.toString()).toBe("Alpha bra**Hi**vo charlie.\n");
  });

  it("forgets the stored mark when the editor switches to another file with the same text", () => {
    const view = codeView("Alpha bra|vo charlie.\n");
    bold(sourceTarget(() => view));
    view.dispatch({ effects: hostTools.reconfigure([]) });
    for (const key of ["H", "i"]) codeKey(view, key);
    expect(view.state.doc.toString()).toBe("Alpha braHivo charlie.\n");
  });

  it("puts the caret back inside the mark on redo", async () => {
    const view = codeView("Alpha bra|vo charlie.\n");
    await settled();
    bold(sourceTarget(() => view));
    for (const key of ["H", "i"]) codeKey(view, key);
    undo(view);
    redo(view);
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("Alpha bra**Hi**vo charlie.\n");
    expect(view.state.selection.main.head).toBe("Alpha bra**Hi".length);
  });
});
