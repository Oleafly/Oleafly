// @vitest-environment jsdom
import { type AnyExtension, Editor } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { AllSelection, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { Network } from "lucide-react";
import { DecorationSet } from "@tiptap/pm/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { registerNoteBlock } from "./note-blocks";
import { noteBaseExtensions, parseNoteMarkdown, serializeNoteMarkdown } from "./note-markdown";
import {
  COVERED_CLASS,
  coveredBlocks,
  NoteSelection,
  noteClipboardText,
  SELECTING,
  SELECTION_ROOT,
  STRAY_SELECTION,
  selectingAttributes,
  selectsAsWhole,
  singleTextblock,
  watchStraySelection,
} from "./note-selection";

const FENCE = "```";
const NOTE = `## Plan

A step with **bold** and $a^2$ math.

- [ ] Open task
- Plain item

${FENCE}drawing
A --> B
${FENCE}

${FENCE}python
print("hi")
${FENCE}

![Figure](assets/figure.svg)

$$
x^2
$$

Last line.
`;

const editors: Editor[] = [];

function build(markdown = NOTE, selection: AnyExtension = NoteSelection): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [...noteBaseExtensions(), selection],
    content: parseNoteMarkdown(markdown).doc,
  });
  editors.push(editor);
  return editor;
}

function positionOf(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return found < 0;
    const at = (node.text ?? "").indexOf(text);
    if (at >= 0) found = pos + at;
    return false;
  });
  if (found < 0) throw new Error(`no text ${text}`);
  return found;
}

function select(editor: Editor, from: string, to: string, toOffset = 0): void {
  const start = positionOf(editor, from);
  const end = positionOf(editor, to) + toOffset;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start, end)));
}

function coveredTypes(editor: Editor): string[] {
  return coveredBlocks(editor.state)
    .find()
    .sort((left, right) => left.from - right.from)
    .map((decoration) => editor.state.doc.nodeAt(decoration.from)?.type.name ?? "");
}

function copiedText(editor: Editor): string {
  const slice = editor.state.selection.content();
  return editor.view.someProp("clipboardTextSerializer", (serialize) => serialize(slice, editor.view)) ?? "";
}

beforeAll(() => {
  registerNoteBlock({ name: "drawing", label: () => "Drawing", icon: Network, paint: () => undefined });
});

afterEach(() => {
  for (const editor of editors.splice(0)) {
    if (editor.isDestroyed) continue;
    editor.view.dom.parentElement?.remove();
    editor.destroy();
  }
  vi.restoreAllMocks();
  document.getSelection()?.removeAllRanges();
});

describe("blocks that select as a whole", () => {
  it("covers drawn blocks and atoms but not text, plain code or line breaks", () => {
    const editor = build("Line one  \nline two");
    const { schema } = editor.state;
    expect(selectsAsWhole(schema.nodes.codeBlock.create({ language: "drawing" }))).toBe(true);
    expect(selectsAsWhole(schema.nodes.codeBlock.create({ language: "python" }))).toBe(false);
    expect(selectsAsWhole(schema.nodes.codeBlock.create({ language: null }))).toBe(false);
    expect(selectsAsWhole(schema.nodes.image.create({ src: "a.png" }))).toBe(true);
    expect(selectsAsWhole(schema.nodes.mathInline.create({ source: "$x$" }))).toBe(true);
    expect(selectsAsWhole(schema.nodes.hardBreak.create())).toBe(false);
    expect(selectsAsWhole(schema.text("x"))).toBe(false);
    expect(selectsAsWhole(schema.nodes.paragraph.create())).toBe(false);
  });

  it("marks every whole block when everything is selected", () => {
    const editor = build();
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    expect(coveredTypes(editor)).toEqual(["mathInline", "codeBlock", "image", "mathInline"]);
    const marked = [...editor.view.dom.querySelectorAll(`.${COVERED_CLASS}`)].map((element) => element.tagName);
    expect(marked).toHaveLength(4);
  });

  it("flags the editor only while something is selected, so the WebKit selection layers exist only then", () => {
    const editor = build();
    expect(editor.view.dom.hasAttribute(SELECTING)).toBe(false);
    expect(selectingAttributes(editor.state)).toEqual({});
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    expect(editor.view.dom.hasAttribute(SELECTING)).toBe(true);
    expect(selectingAttributes(editor.state)).toEqual({ [SELECTING]: "" });
    select(editor, "A step", "A step");
    expect(editor.view.dom.hasAttribute(SELECTING)).toBe(false);
  });

  it("makes only the blocks a selection touches their own selection roots, so selecting never restyles the whole note", () => {
    const editor = build();
    const roots = () =>
      [...editor.view.dom.querySelectorAll<HTMLElement>(`.${SELECTION_ROOT}`)].map((element) => element.textContent?.trim());
    expect(roots()).toEqual([]);
    select(editor, "Open task", "A --> B", 2);
    expect(roots()).toEqual(["Open task", "Plain item", "A --> B"]);
    expect([...editor.view.dom.querySelectorAll(`.${SELECTION_ROOT}`)].map((element) => element.tagName)).toEqual(["LI", "LI", "PRE"]);
    select(editor, "Last", "line");
    expect(roots()).toEqual([]);
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    expect(roots()).toEqual(["Open task", "Plain item", "A --> B", 'print("hi")']);
    select(editor, "A step", "A step");
    expect(roots()).toEqual([]);
  });

  it("marks only the blocks a range fully covers", () => {
    const editor = build();
    select(editor, "A step", "print");
    expect(coveredTypes(editor)).toEqual(["mathInline", "codeBlock"]);
    select(editor, "A step", "A --> B", 2);
    expect(coveredTypes(editor)).toEqual(["mathInline"]);
    select(editor, "bold", "Last line");
    expect(coveredTypes(editor)).toEqual(["mathInline", "codeBlock", "image", "mathInline"]);
  });

  it("marks nothing for an empty selection or a selected node", () => {
    const editor = build();
    select(editor, "A step", "A step");
    expect(coveredBlocks(editor.state)).toBe(DecorationSet.empty);
    let image = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") image = pos;
    });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, image)));
    expect(coveredBlocks(editor.state).find()).toEqual([]);
    expect(editor.view.dom.querySelector(`.${COVERED_CLASS}`)).toBeNull();
  });

  it("keeps the marks across transactions that change neither the document nor the selection", () => {
    const editor = build();
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    const before = editor.view.dom.querySelectorAll(`.${COVERED_CLASS}`).length;
    editor.view.dispatch(editor.state.tr.setMeta("unrelated", true));
    expect(editor.view.dom.querySelectorAll(`.${COVERED_CLASS}`)).toHaveLength(before);
    editor.view.dispatch(editor.state.tr.insertText("x", 1));
    expect(editor.view.dom.querySelectorAll(`.${COVERED_CLASS}`)).toHaveLength(before);
    editor.view.dispatch(editor.state.tr.insertText("x"));
    expect(editor.view.dom.querySelector(`.${COVERED_CLASS}`)).toBeNull();
  });

  it("does not walk the selection again when it is set to the same range", () => {
    const editor = build();
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    const walk = vi.spyOn(editor.state.doc, "nodesBetween");
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    expect(walk).not.toHaveBeenCalled();
    walk.mockRestore();
  });
});

describe("copied text", () => {
  it("copies the note as Markdown after select all", () => {
    const editor = build();
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    const text = copiedText(editor);
    expect(text).toBe(serializeNoteMarkdown(editor.getJSON()).replace(/\n+$/u, ""));
    expect(text).toContain("- [ ] Open task");
    expect(text).toContain(`${FENCE}drawing\nA --> B\n${FENCE}`);
    expect(text).toContain("A step with **bold** and $a^2$ math.");
    expect(text).not.toMatch(/\u200b|\u200c|\u200d|\ufeff/u);
  });

  it("copies the note's own source when the caller supplies it", () => {
    const source = vi.fn(() => "Exact source\n\n---\n\nkept\n\n");
    const editor = build(NOTE, NoteSelection.configure({ wholeNote: source }));
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    expect(copiedText(editor)).toBe("Exact source\n\n---\n\nkept");
    expect(source).toHaveBeenCalledWith(editor.state.doc);
    select(editor, "Open task", "Plain item", "Plain item".length);
    expect(copiedText(editor)).toBe("- [ ] Open task\n- Plain item");
    expect(source).toHaveBeenCalledTimes(1);
  });

  it("copies Markdown for a range across blocks", () => {
    const editor = build();
    select(editor, "Open task", "Plain item", "Plain item".length);
    expect(copiedText(editor)).toBe("- [ ] Open task\n- Plain item");
  });

  it("copies plain text with math source inside one paragraph or code block", () => {
    const editor = build("Before $a^2$ after  \nnext\n\n- in a list\n");
    select(editor, "Before", "next", "next".length);
    expect(copiedText(editor)).toBe("Before $a^2$ after\nnext");
    select(editor, "in a", "list", "list".length);
    expect(copiedText(editor)).toBe("in a list");
    const code = build(`${FENCE}python\nprint("hi")\n${FENCE}\n`);
    select(code, "print", "hi");
    expect(copiedText(code)).toBe('print("');
  });

  it("serializes slices directly", () => {
    const editor = build();
    const { doc, schema } = editor.state;
    const paragraph = schema.nodes.paragraph.create(null, schema.text("loose"));
    expect(noteClipboardText(new Slice(Fragment.from(paragraph), 0, 0), doc)).toBe("loose");
    expect(noteClipboardText(new Slice(Fragment.from(schema.text("inline")), 0, 0), doc)).toBe("");
    const noted = schema.nodes.paragraph.create(null, [schema.text("see"), schema.nodes.footnote.create({ source: "aside" })]);
    expect(noteClipboardText(new Slice(Fragment.from(noted), 1, 1), doc)).toBe("see");
    expect(noteClipboardText(doc.slice(0, doc.content.size), doc)).toBe(serializeNoteMarkdown(doc.toJSON()).replace(/\n+$/u, ""));
  });

  it("finds a single open text block only when both sides open to it", () => {
    const editor = build();
    const { schema } = editor.state;
    const paragraph = schema.nodes.paragraph.create(null, schema.text("x"));
    const quote = schema.nodes.blockquote.create(null, paragraph);
    expect(singleTextblock(new Slice(Fragment.from(paragraph), 1, 1))).toBe(paragraph);
    expect(singleTextblock(new Slice(Fragment.from(quote), 2, 2))).toBe(paragraph);
    expect(singleTextblock(new Slice(Fragment.from(paragraph), 0, 0))).toBeNull();
    expect(singleTextblock(new Slice(Fragment.from(paragraph), 1, 0))).toBeNull();
    expect(singleTextblock(new Slice(Fragment.from([paragraph, paragraph]), 1, 1))).toBeNull();
    expect(singleTextblock(new Slice(Fragment.from(quote), 1, 1))).toBeNull();
    expect(singleTextblock(new Slice(Fragment.from(paragraph), 2, 2))).toBeNull();
  });
});

describe("selections that leave the note text", () => {
  function selectNode(node: Node): void {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }

  it("flags the editor while the page selection sits in a widget or outside it", () => {
    const editor = build("Text here $x$.");
    const { dom } = editor.view;
    const widget = dom.querySelector('[data-type="math-inline"]') as HTMLElement;
    expect(widget.getAttribute("contenteditable")).toBe("false");
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.append(outside);

    selectNode(dom.querySelector("p")?.firstChild as Node);
    expect(dom.hasAttribute(STRAY_SELECTION)).toBe(false);
    selectNode(widget);
    expect(dom.hasAttribute(STRAY_SELECTION)).toBe(true);
    selectNode(dom.querySelector("p")?.firstChild as Node);
    expect(dom.hasAttribute(STRAY_SELECTION)).toBe(false);
    selectNode(outside);
    expect(dom.hasAttribute(STRAY_SELECTION)).toBe(true);
    selectNode(dom);
    expect(dom.hasAttribute(STRAY_SELECTION)).toBe(false);
    document.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    expect(dom.hasAttribute(STRAY_SELECTION)).toBe(true);
    outside.remove();
  });

  it("updates every open editor from one shared page listener", () => {
    const first = build("First.");
    const second = build("Second.");
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const extra = watchStraySelection(second.view);
    expect(add.mock.calls.some(([name]) => name === "selectionchange")).toBe(false);
    selectNode(first.view.dom.querySelector("p")?.firstChild as Node);
    expect(first.view.dom.hasAttribute(STRAY_SELECTION)).toBe(false);
    expect(second.view.dom.hasAttribute(STRAY_SELECTION)).toBe(true);
    selectNode(second.view.dom.querySelector("p")?.firstChild as Node);
    expect(first.view.dom.hasAttribute(STRAY_SELECTION)).toBe(true);
    extra.destroy();
    for (const editor of editors.splice(0)) {
      editor.view.dom.parentElement?.remove();
      editor.destroy();
    }
    expect(remove.mock.calls.filter(([name, listener]) => name === "selectionchange" && typeof listener === "function" && listener.name === "syncStraySelections")).toHaveLength(1);
  });

  it("stops watching and clears the flag when the view goes away", () => {
    const editor = build("Text here.");
    const { dom } = editor.view;
    const watcher = watchStraySelection(editor.view);
    vi.spyOn(document, "getSelection").mockReturnValue(null);
    document.dispatchEvent(new Event("selectionchange"));
    expect(dom.hasAttribute(STRAY_SELECTION)).toBe(true);
    watcher.destroy();
    editor.destroy();
    expect(dom.hasAttribute(STRAY_SELECTION)).toBe(false);
    document.dispatchEvent(new Event("selectionchange"));
    expect(dom.hasAttribute(STRAY_SELECTION)).toBe(false);
  });
});
