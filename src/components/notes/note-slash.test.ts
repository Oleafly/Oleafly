// @vitest-environment jsdom
import { createWysiwygExtensions } from "@oleafly/wysiwyg";
import { Editor, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { withBlockViews } from "./block-views";
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

const editors: Editor[] = [];

function build(content: JSONContent[] = [{ type: "paragraph" }], base = noteBaseExtensions()): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [...base.map(withBlockViews), NoteSlash],
    content: { type: "doc", content },
  });
  editors.push(editor);
  return editor;
}

function type(editor: Editor, text: string) {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (handler) => handler(editor.view, from, to, character, () => editor.state.tr));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(character, from, to));
  }
}

function key(editor: Editor, name: string): boolean {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  return editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event)) ?? false;
}

function topTypes(editor: Editor): string[] {
  return (editor.getJSON().content ?? []).map((node) => node.type ?? "");
}

function pick(editor: Editor, id: string): boolean {
  const index = visibleSlashItems(editor).findIndex((item) => item.id === id);
  return chooseSlash(editor, index);
}

beforeAll(async () => {
  await loadNamespace("notes");
});

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("slashMatch", () => {
  it("opens for a slash at the start of an empty paragraph and tracks the query", () => {
    const editor = build();
    type(editor, "/");
    expect(slashMatch(editor.state)).toEqual({ from: 1, to: 2, query: "" });
    type(editor, "hea");
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
    type(table, "/");
    expect(slashMatch(table.state)).toBeNull();
    const list = build([{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }]);
    list.commands.setTextSelection(3);
    type(list, "/");
    expect(slashMatch(list.state)?.query).toBe("");
  });
});

describe("slash items", () => {
  it("offers basic blocks and every insertable block, hiding what the editor cannot do", () => {
    const editor = build();
    const ids = slashItems(editor).map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(["heading1", "bulletList", "taskList", "callout", "table", "code", "math", "block:csv", "block:jsx", "block:molecule"]));
    expect(ids).not.toContain("divider");
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
    type(editor, "/head");
    expect(key(editor, "ArrowDown")).toBe(true);
    expect(slashState(editor.state).index).toBe(1);
    expect(key(editor, "ArrowUp")).toBe(true);
    expect(key(editor, "ArrowUp")).toBe(true);
    expect(slashState(editor.state).index).toBe(2);
    expect(key(editor, "Enter")).toBe(true);
    expect(editor.getJSON().content?.[0]).toEqual({ type: "heading", attrs: expect.objectContaining({ level: 3 }) });
    expect(slashState(editor.state).active).toBe(false);
  });

  it("keeps the highlighted item while the query stays, and resets it when the query changes", () => {
    const editor = build();
    type(editor, "/");
    moveSlash(editor.view, 4);
    expect(slashState(editor.state).index).toBe(4);
    editor.view.dispatch(editor.state.tr.setMeta("other", true));
    expect(slashState(editor.state).index).toBe(4);
    type(editor, "c");
    expect(slashState(editor.state).index).toBe(0);
  });

  it("closes on Escape until the slash is typed again", () => {
    const editor = build();
    type(editor, "/");
    expect(key(editor, "Escape")).toBe(true);
    expect(slashState(editor.state).active).toBe(false);
    type(editor, "x");
    expect(slashState(editor.state).active).toBe(false);
    editor.commands.deleteRange({ from: 1, to: 3 });
    type(editor, "/");
    expect(slashState(editor.state).active).toBe(true);
    dismissSlash(editor.view);
    expect(slashState(editor.state)).toMatchObject({ active: false, dismissed: 1 });
  });

  it("lets other keys through and Enter through when nothing matches", () => {
    const editor = build();
    expect(key(editor, "ArrowDown")).toBe(false);
    type(editor, "/zzz");
    expect(visibleSlashItems(editor)).toEqual([]);
    key(editor, "Enter");
    expect(topTypes(editor).slice(0, 2)).toEqual(["paragraph", "paragraph"]);
    const open = build();
    type(open, "/");
    expect(key(open, "a")).toBe(false);
    expect(chooseSlash(open, 999)).toBe(false);
    expect(slashOptionId("note-slash-menu-1", 3)).toBe("note-slash-menu-1-option-3");
  });

  it("names its options per editor and points the editor at the highlighted one", () => {
    const first = build();
    const second = build();
    type(first, "/");
    type(second, "/");
    const firstMenu = slashMenuId(first.state);
    expect(firstMenu).not.toBe(slashMenuId(second.state));
    expect(first.view.dom.getAttribute("aria-controls")).toBe(firstMenu);
    expect(first.view.dom.getAttribute("aria-activedescendant")).toBe(slashOptionId(firstMenu, 0));
    key(first, "ArrowDown");
    expect(first.view.dom.getAttribute("aria-activedescendant")).toBe(slashOptionId(firstMenu, 1));
  });

  it("leaves Enter to the input method while it composes text", () => {
    const editor = build();
    type(editor, "/quote");
    const composing = new KeyboardEvent("keydown", { key: "Enter" });
    Object.defineProperty(composing, "keyCode", { value: 229 });
    const plugin = noteSlashKey.get(editor.state);
    expect(plugin?.props.handleKeyDown?.call(plugin, editor.view, composing)).toBe(false);
    expect(slashState(editor.state).active).toBe(true);
    expect(topTypes(editor)).toEqual(["paragraph"]);
  });

  it("chooses with Tab", () => {
    const editor = build();
    type(editor, "/quote");
    expect(key(editor, "Tab")).toBe(true);
    expect(topTypes(editor)[0]).toBe("blockquote");
  });

  it.each([
    ["heading1", ["heading"]],
    ["heading2", ["heading"]],
    ["bulletList", ["bulletList"]],
    ["orderedList", ["orderedList"]],
    ["taskList", ["taskList"]],
    ["table", ["table"]],
    ["code", ["codeBlock"]],
    ["math", ["mathDisplay"]],
  ])("inserts %s in place of the slash", (id, types) => {
    const editor = build();
    type(editor, "/");
    expect(pick(editor, id)).toBe(true);
    expect(topTypes(editor).slice(0, types.length)).toEqual(types);
    expect(editor.getText()).not.toContain("/");
  });

  it("starts a callout from a quote with a note header", () => {
    const editor = build();
    type(editor, "/callout");
    expect(pick(editor, "callout")).toBe(true);
    expect(topTypes(editor)[0]).toMatch(/callout|blockquote/u);
    expect(editor.getText()).not.toContain("/callout");
  });

  it("inserts a block with its template", () => {
    const editor = build();
    type(editor, "/chart");
    expect(pick(editor, "block:chart")).toBe(true);
    const block = editor.getJSON().content?.find((node) => node.type === "codeBlock");
    expect(block?.attrs?.language).toBe("chart");
    const text = (block?.content?.[0] as { text?: string } | undefined)?.text;
    expect(JSON.parse(text ?? "{}").categories).toEqual(["A", "B", "C"]);
  });

  it("names its groups and items in the interface language", () => {
    const editor = build();
    const items = slashItems(editor);
    expect(items.find((item) => item.id === "heading1")?.label).toBe("Heading 1");
    expect(items.find((item) => item.id === "quote")?.label).toBe(enNotes.blocks.slash.quote);
    expect(new Set(items.map((item) => item.group))).toEqual(new Set(["basic", "data", "math", "diagrams", "code", "science"]));
  });
});
