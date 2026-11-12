// @vitest-environment jsdom
import { createWysiwygExtensions } from "@oleafly/wysiwyg";
import { type AnyExtension, Editor, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { withBlockViews } from "./block-views";
import { NoteImageDrop } from "./note-image-drop";
import { noteBaseExtensions } from "./note-markdown";
import {
  chooseSlash,
  dismissSlash,
  filterSlashItems,
  moveSlash,
  NoteSlash,
  noteSlashKey,
  slashItems,
  slashMatch,
  slashMenuId,
  slashOptionId,
  slashState,
  visibleSlashItems,
} from "./note-slash";
import { pressKey, typeInto } from "./tests/kb-editor-fixtures";
import "./tests/setup";

const editors: Editor[] = [];

function build(content: JSONContent[] = [{ type: "paragraph" }], base = noteBaseExtensions(), extra: AnyExtension[] = []): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [...base.map(withBlockViews), NoteSlash, ...extra],
    content: { type: "doc", content },
  });
  editors.push(editor);
  return editor;
}

function topTypes(editor: Editor): string[] {
  return (editor.getJSON().content ?? []).map((node) => node.type ?? "");
}

function pick(editor: Editor, id: string): boolean {
  const index = visibleSlashItems(editor).findIndex((item) => item.id === id);
  return chooseSlash(editor, index);
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("slashMatch", () => {
  it("opens for a slash at the start of an empty paragraph and tracks the query", () => {
    const editor = build();
    typeInto(editor, "/");
    expect(slashMatch(editor.state)).toEqual({ from: 1, to: 2, query: "" });
    typeInto(editor, "hea");
    expect(slashState(editor.state)).toMatchObject({ active: true, query: "hea", index: 0 });
  });

  it.each([
    ["text before the slash", [{ type: "paragraph", content: [{ type: "text", text: "a/" }] }], 3],
    ["a space after the slash", [{ type: "paragraph", content: [{ type: "text", text: "/ x" }] }], 4],
    ["a cursor before the end", [{ type: "paragraph", content: [{ type: "text", text: "/abc" }] }], 2],
    ["a code block", [{ type: "codeBlock", content: [{ type: "text", text: "/abc" }] }], 5],
    ["a long query", [{ type: "paragraph", content: [{ type: "text", text: `/${"a".repeat(40)}` }] }], 42],
  ])("stays closed for %s", (_name, content, position) => {
    const editor = build(content as JSONContent[]);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)));
    expect(slashMatch(editor.state)).toBeNull();
    expect(slashState(editor.state).active).toBe(false);
  });

  it("stays closed for a range selection and inside tables, but opens in lists", () => {
    const editor = build([{ type: "paragraph", content: [{ type: "text", text: "/ab" }] }]);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 3)));
    expect(slashMatch(editor.state)).toBeNull();
    const table = build();
    table.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    typeInto(table, "/");
    expect(slashMatch(table.state)).toBeNull();
    const list = build([{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }]);
    list.commands.setTextSelection(3);
    typeInto(list, "/");
    expect(slashMatch(list.state)?.query).toBe("");
  });
});

describe("slash items", () => {
  it("offers basic blocks and every insertable block, hiding what the editor cannot do", () => {
    const editor = build();
    const ids = slashItems(editor).map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(["heading1", "bulletList", "taskList", "callout", "table", "code", "math", "block:csv", "block:jsx", "block:molecule"]));
    expect(ids).toContain("divider");
    expect(ids).not.toContain("attach");
    const plain = build([{ type: "paragraph" }], createWysiwygExtensions());
    expect(slashItems(plain).map((item) => item.id)).not.toContain("taskList");
  });

  it("filters by label and keywords, best matches first", () => {
    const editor = build();
    const items = slashItems(editor);
    expect(filterSlashItems(items, "")).toHaveLength(items.length);
    expect(filterSlashItems(items, "h2")[0].id).toBe("heading2");
    expect(filterSlashItems(items, "dna")[0].id).toBe("block:sequence");
    expect(filterSlashItems(items, "tsx")[0].id).toBe("block:jsx");
    expect(filterSlashItems(items, "head 3").map((item) => item.id)).toEqual(["heading3"]);
    expect(filterSlashItems(items, "table")[0].id).toBe("table");
    expect(filterSlashItems(items, "zzz")).toEqual([]);
  });
});

describe("slash plugin", () => {
  it("moves with the arrow keys, wraps around and inserts with Enter", () => {
    const editor = build();
    typeInto(editor, "/head");
    expect(pressKey(editor, "ArrowDown")).toBe(true);
    expect(slashState(editor.state).index).toBe(1);
    expect(pressKey(editor, "ArrowUp")).toBe(true);
    expect(pressKey(editor, "ArrowUp")).toBe(true);
    expect(slashState(editor.state).index).toBe(5);
    expect(pressKey(editor, "Enter")).toBe(true);
    expect(editor.getJSON().content?.[0]).toEqual({ type: "heading", attrs: expect.objectContaining({ level: 6 }) });
    expect(slashState(editor.state).active).toBe(false);
  });

  it("keeps the highlighted item while the query stays, and resets it when the query changes", () => {
    const editor = build();
    typeInto(editor, "/");
    moveSlash(editor.view, 4);
    expect(slashState(editor.state).index).toBe(4);
    editor.view.dispatch(editor.state.tr.setMeta("other", true));
    expect(slashState(editor.state).index).toBe(4);
    typeInto(editor, "c");
    expect(slashState(editor.state).index).toBe(0);
  });

  it("closes on Escape until the slash is typed again", () => {
    const editor = build();
    typeInto(editor, "/");
    expect(pressKey(editor, "Escape")).toBe(true);
    expect(slashState(editor.state).active).toBe(false);
    typeInto(editor, "x");
    expect(slashState(editor.state).active).toBe(false);
    editor.commands.deleteRange({ from: 1, to: 3 });
    typeInto(editor, "/");
    expect(slashState(editor.state).active).toBe(true);
    dismissSlash(editor.view);
    expect(slashState(editor.state)).toMatchObject({ active: false, dismissed: 1 });
  });

  it("works the visible items out once per editor state", () => {
    const editor = build();
    typeInto(editor, "/he");
    const items = visibleSlashItems(editor);
    expect(items.length).toBeGreaterThan(0);
    expect(visibleSlashItems(editor)).toBe(items);
    typeInto(editor, "a");
    expect(visibleSlashItems(editor)).not.toBe(items);
  });

  it("stays closed after Escape when text above moves the slash", () => {
    const editor = build([{ type: "paragraph", content: [{ type: "text", text: "a" }] }, { type: "paragraph" }]);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)));
    typeInto(editor, "/");
    expect(slashState(editor.state)).toMatchObject({ active: true, from: 4 });
    dismissSlash(editor.view);
    editor.view.dispatch(editor.state.tr.insertText("b", 1));
    expect(slashMatch(editor.state)?.from).toBe(5);
    expect(slashState(editor.state)).toMatchObject({ active: false, dismissed: 5 });
  });

  it("lets other keys through and Enter through when nothing matches", () => {
    const editor = build();
    expect(pressKey(editor, "ArrowDown")).toBe(false);
    typeInto(editor, "/zzz");
    expect(visibleSlashItems(editor)).toEqual([]);
    pressKey(editor, "Enter");
    expect(topTypes(editor).slice(0, 2)).toEqual(["paragraph", "paragraph"]);
    const open = build();
    typeInto(open, "/");
    expect(pressKey(open, "a")).toBe(false);
    expect(chooseSlash(open, 999)).toBe(false);
    expect(slashOptionId("note-slash-menu-1", 3)).toBe("note-slash-menu-1-option-3");
  });

  it("names its options per editor and points the editor at the highlighted one", () => {
    const first = build();
    const second = build();
    typeInto(first, "/");
    typeInto(second, "/");
    const firstMenu = slashMenuId(first.state);
    expect(firstMenu).not.toBe(slashMenuId(second.state));
    expect(first.view.dom.getAttribute("aria-controls")).toBe(firstMenu);
    expect(first.view.dom.getAttribute("aria-activedescendant")).toBe(slashOptionId(firstMenu, 0));
    pressKey(first, "ArrowDown");
    expect(first.view.dom.getAttribute("aria-activedescendant")).toBe(slashOptionId(firstMenu, 1));
  });

  it("leaves Enter to the input method while it composes text", () => {
    const editor = build();
    typeInto(editor, "/quote");
    const composing = new KeyboardEvent("keydown", { key: "Enter" });
    Object.defineProperty(composing, "keyCode", { value: 229 });
    const plugin = noteSlashKey.get(editor.state);
    expect(plugin?.props.handleKeyDown?.call(plugin, editor.view, composing)).toBe(false);
    expect(slashState(editor.state).active).toBe(true);
    expect(topTypes(editor)).toEqual(["paragraph"]);
  });

  it("chooses with Tab", () => {
    const editor = build();
    typeInto(editor, "/quote");
    expect(pressKey(editor, "Tab")).toBe(true);
    expect(topTypes(editor)[0]).toBe("blockquote");
  });

  it.each([
    ["heading1", ["heading"]],
    ["heading6", ["heading"]],
    ["divider", ["horizontalRule"]],
    ["bulletList", ["bulletList"]],
    ["orderedList", ["orderedList"]],
    ["taskList", ["taskList"]],
    ["table", ["table"]],
    ["code", ["codeBlock"]],
    ["math", ["mathDisplay"]],
  ])("inserts %s in place of the slash", (id, types) => {
    const editor = build();
    typeInto(editor, "/");
    expect(pick(editor, id)).toBe(true);
    expect(topTypes(editor).slice(0, types.length)).toEqual(types);
    expect(editor.getText()).not.toContain("/");
  });

  it("asks for a file in place of the slash and inserts the block that shows it", async () => {
    const attach = vi.fn(async () => "assets/panel-1a2b3c4d.xlsx");
    const editor = build(undefined, undefined, [NoteImageDrop.configure({ target: () => ({ projectId: "note-1", notePath: null }), attach: () => attach })]);
    typeInto(editor, "/attach");
    expect(pick(editor, "attach")).toBe(true);
    await vi.waitFor(() => expect(topTypes(editor)[0]).toBe("codeBlock"));
    expect(attach).toHaveBeenCalledWith("note-1", expect.objectContaining({ extensions: expect.arrayContaining(["csv", "xlsx", "pdb", "ipynb", "png"]) }));
    expect(editor.getJSON().content?.[0]).toMatchObject({ attrs: { language: "csv" }, content: [{ text: "path: assets/panel-1a2b3c4d.xlsx" }] });
    expect(editor.getText()).not.toContain("/attach");
  });

  it("puts a footnote in place of the slash and its text at the end of the note", () => {
    const editor = build([{ type: "paragraph" }, { type: "paragraph", content: [{ type: "text", text: "Last" }] }]);
    editor.commands.setTextSelection(1);
    typeInto(editor, "/footnote");
    expect(pick(editor, "footnote")).toBe(true);
    typeInto(editor, "Why.");
    expect(editor.getJSON().content).toEqual([
      { type: "paragraph", attrs: { blockId: null }, content: [{ type: "rawInline", attrs: { source: "[^1]" } }] },
      { type: "paragraph", attrs: { blockId: null }, content: [{ type: "text", text: "Last" }] },
      { type: "paragraph", attrs: { blockId: null }, content: [{ type: "rawInline", attrs: { source: "[^1]" } }, { type: "text", text: ": Why." }] },
    ]);
  });

  it("starts a callout from a quote with a note header", () => {
    const editor = build();
    typeInto(editor, "/callout");
    expect(pick(editor, "callout")).toBe(true);
    expect(topTypes(editor)[0]).toMatch(/callout|blockquote/u);
    expect(editor.getText()).not.toContain("/callout");
  });

  it("inserts a block with its template", () => {
    const editor = build();
    typeInto(editor, "/chart");
    expect(pick(editor, "block:chart")).toBe(true);
    const block = editor.getJSON().content?.find((node) => node.type === "codeBlock");
    expect(block?.attrs?.language).toBe("chart");
    const text = (block?.content?.[0] as { text?: string } | undefined)?.text;
    expect(JSON.parse(text ?? "{}").categories).toEqual(["A", "B", "C"]);
  });

  it.each([
    ["d2", "d2", "direction: right"],
    ["tikz", "tikz", "\\begin{tikzpicture}"],
    ["circuit", "circuitikz", "\\begin{circuitikz}"],
  ])("finds the %s diagram block and inserts its %s fence", (query, kind, start) => {
    const editor = build();
    typeInto(editor, `/${query}`);
    expect(pick(editor, `block:${kind}`)).toBe(true);
    const block = editor.getJSON().content?.find((node) => node.type === "codeBlock");
    expect(block?.attrs?.language).toBe(kind);
    expect((block?.content?.[0] as { text?: string } | undefined)?.text).toContain(start);
  });

  it("leaves the caret on a line after the block it inserts", () => {
    const editor = build();
    typeInto(editor, "/mermaid");
    expect(pick(editor, "block:mermaid")).toBe(true);
    const { $head } = editor.state.selection;
    expect($head.parent.type.name).toBe("paragraph");
    expect($head.node($head.depth - 1).child($head.index($head.depth - 1) - 1).type.name).toBe("codeBlock");
  });

  it("names its groups and items in the interface language", () => {
    const editor = build();
    const items = slashItems(editor);
    expect(items.find((item) => item.id === "heading1")?.label).toBe("Heading 1");
    expect(items.find((item) => item.id === "quote")?.label).toBe(enNotes.blocks.slash.quote);
    expect(new Set(items.map((item) => item.group))).toEqual(new Set(["basic", "data", "math", "diagrams", "code", "science"]));
  });
});
