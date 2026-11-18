// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Editor, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { WYSIWYG_EXTENSIONS, createMarkdownSourceSnapshot, parseMarkdownBody, serializeMarkdownBody } from "@oleafly/wysiwyg";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { markdownFormatKeymap } from "./markdown-keymap";
import { type MarkdownTarget, modelState, RESTING_STATE, sourceTarget, visualStateOf, visualTarget } from "./markdown-model";
import { QuoteOrBoldKey, toggleQuote } from "./rich-text-controls";

type Pick = { word: string } | { caret: string } | { range: [string, string] };
type Act = (target: MarkdownTarget) => void;

const opened: { destroy: () => void }[] = [];

beforeAll(() => {
  if (!("getClientRects" in Range.prototype)) Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
});

afterEach(() => {
  for (const item of opened.splice(0)) item.destroy();
});

function sourceRange(source: string, pick: Pick): { from: number; to: number } {
  if ("word" in pick) {
    const from = source.indexOf(pick.word);
    return { from, to: from + pick.word.length };
  }
  if ("caret" in pick) {
    const at = source.indexOf(pick.caret) + pick.caret.length;
    return { from: at, to: at };
  }
  return { from: source.indexOf(pick.range[0]), to: source.indexOf(pick.range[1]) + pick.range[1].length };
}

function docPosition(editor: Editor, needle: string, after: boolean): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText || !node.text) return found < 0;
    const index = node.text.indexOf(needle);
    if (index >= 0) found = pos + index + (after ? needle.length : 0);
    return false;
  });
  if (found < 0) throw new Error(`no ${needle}`);
  return found;
}

function visualEditor(source: string, pick: Pick) {
  const { doc, frontmatter, layout } = parseMarkdownBody(source);
  const editor = new Editor({ element: document.createElement("div"), extensions: [...WYSIWYG_EXTENSIONS, QuoteOrBoldKey], content: doc });
  opened.push(editor);
  const snapshot = createMarkdownSourceSnapshot(layout, editor.getJSON());
  const [from, to] =
    "word" in pick
      ? [docPosition(editor, pick.word, false), docPosition(editor, pick.word, true)]
      : "caret" in pick
        ? [docPosition(editor, pick.caret, true), docPosition(editor, pick.caret, true)]
        : [docPosition(editor, pick.range[0], false), docPosition(editor, pick.range[1], true)];
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
  return { editor, save: () => frontmatter + serializeMarkdownBody(editor.getJSON(), snapshot) };
}

function quoteKey(editor: Editor) {
  const event = new KeyboardEvent("keydown", { key: "B", code: "KeyB", keyCode: 66, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
  editor.view.someProp("handleKeyDown", (handle) => handle(editor.view, event));
}

function visual(source: string, pick: Pick, act: Act | "key", typed?: string): string {
  const { editor, save } = visualEditor(source, pick);
  if (act === "key") quoteKey(editor);
  else act(visualTarget(editor));
  if (typed !== undefined) editor.view.dispatch(editor.state.tr.insertText(typed));
  return save();
}

function codeView(source: string, pick: Pick) {
  const { from, to } = sourceRange(source, pick);
  const view = new EditorView({
    state: EditorState.create({ doc: source, selection: { anchor: from, head: to }, extensions: [markdownFormatKeymap] }),
    parent: document.body,
  });
  opened.push(view);
  return view;
}

async function code(source: string, pick: Pick, act: Act | "key", typed?: string): Promise<string> {
  const view = codeView(source, pick);
  if (act === "key") {
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "B", keyCode: 66, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  } else act(sourceTarget(() => view));
  for (const key of typed ?? "") view.dispatch({ ...view.state.replaceSelection(key), userEvent: "input.type" });
  return view.state.doc.toString();
}

const TABLE = "| a | b |\n| --- | --- |\n| c | word |\n\nNext.\n";
const TASK = "- [ ] task word\n";
const QUOTED_LIST = "> - item word\n\nNext.\n";
const quote: Act = (target) => target.quote();

describe("Quote and the ⌘⇧B key in a table cell", () => {
  it.each([
    ["the toolbar's Quote on a word", { word: "word" } as Pick, quote, undefined, TABLE],
    ["the toolbar's Quote at a caret, then typing", { caret: "wo" } as Pick, quote, "Hi", "| a | b |\n| --- | --- |\n| c | woHird |\n\nNext.\n"],
    ["the toolbar's Quote across two cells", { range: ["c", "word"] } as Pick, quote, undefined, TABLE],
    ["⌘⇧B on a word", { word: "word" } as Pick, "key" as const, undefined, "| a | b |\n| --- | --- |\n| c | **word** |\n\nNext.\n"],
    ["⌘⇧B at a caret, then typing", { caret: "wo" } as Pick, "key" as const, "Hi", "| a | b |\n| --- | --- |\n| c | wo**Hi**rd |\n\nNext.\n"],
  ])("%s keeps the row whole and matches in both modes", { timeout: 20_000 }, async (_, pick, act, typed, expected) => {
    expect(visual(TABLE, pick, act, typed)).toBe(expected);
    expect(await code(TABLE, pick, act, typed)).toBe(expected);
  });

  it("⌘⇧B across two cells bolds the cells and writes no HTML table, in both modes", { timeout: 20_000 }, async () => {
    const pick: Pick = { range: ["c", "word"] };
    const fromVisual = visual(TABLE, pick, "key");
    expect(fromVisual).not.toContain("<table");
    expect(fromVisual).toMatch(/^\| a \| b \|\n\| --- \| --- \|\n\| \*\*c\*\* \| (?:\*\*word\*\*|word) \|\n\nNext\.\n$/u);
    expect(await code(TABLE, pick, "key")).toBe(fromVisual);
  });

  it("turns the Quote control off in a cell and on outside the table, in both modes", () => {
    expect(RESTING_STATE.quotes).toBe(true);
    for (const pick of [{ caret: "wo" }, { word: "word" }, { range: ["c", "word"] }] as Pick[]) {
      expect(visualStateOf(visualEditor(TABLE, pick).editor)?.quotes).toBe(false);
      expect(modelState(codeView(TABLE, pick).state).quotes).toBe(false);
    }
    expect(visualStateOf(visualEditor(TABLE, { caret: "Ne" }).editor)?.quotes).toBe(true);
    expect(modelState(codeView(TABLE, { caret: "Ne" }).state).quotes).toBe(true);
  });

  it("still quotes a whole table from outside it", () => {
    const { editor, save } = visualEditor("Lead.\n\n| a | b |\n| --- | --- |\n| c | zed |\n", { range: ["Lead", "zed"] });
    expect(toggleQuote(editor)).toBe(true);
    expect(save()).toBe("> Lead.\n>\n> | a | b |\n> | --- | --- |\n> | c | zed |\n");
  });
});

describe("alignment on a task item", () => {
  it.each(["justify", "center", "right"] as const)("%s leaves '- [ ] task word' a task item in both modes", { timeout: 20_000 }, async (align) => {
    const act: Act = (target) => target.align(align);
    expect(visual(TASK, { word: "word" }, act)).toBe(TASK);
    expect(await code(TASK, { word: "word" }, act)).toBe(TASK);
  });

  it("aligns the paragraph next to a task item and leaves the item alone", { timeout: 20_000 }, async () => {
    const source = "Lead word.\n\n- [x] done task\n";
    const act: Act = (target) => target.align("center");
    const expected = "::: {.center}\nLead word.\n:::\n\n- [x] done task\n";
    expect(visual(source, { range: ["Lead", "task"] }, act)).toBe(expected);
    expect(await code(source, { range: ["Lead", "task"] }, act)).toBe(expected);
  });

  it("still aligns a plain list item and a list item that only mentions brackets", { timeout: 20_000 }, async () => {
    const act: Act = (target) => target.align("center");
    expect(visual("- plain word\n", { word: "word" }, act)).toBe("- ::: {.center}\n  plain word\n  :::\n");
    expect(visual("- see [x](y) word\n", { word: "word" }, act)).toBe("- ::: {.center}\n  see [x](y) word\n  :::\n");
  });

  it("aligns a list item that starts with escaped brackets, which is not a task, in both modes", { timeout: 20_000 }, async () => {
    const source = "- \\[ \\] not a task word\n";
    const act: Act = (target) => target.align("center");
    const expected = "- ::: {.center}\n  \\[ \\] not a task word\n  :::\n";
    expect(visual(source, { word: "word" }, act)).toBe(expected);
    expect(await code(source, { word: "word" }, act)).toBe(expected);
  });

  it("disables the alignment control on a task line and keeps Left for one that was aligned before", () => {
    expect(visualStateOf(visualEditor(TASK, { word: "word" }).editor)?.aligns).toBe(false);
    expect(visualStateOf(visualEditor("- plain word\n", { word: "word" }).editor)?.aligns).toBe(true);
    const aligned = visualEditor("- ::: {.center}\n  [ ] task word\n  :::\n", { word: "word" });
    expect(visualStateOf(aligned.editor)?.aligns).toBe(true);
    visualTarget(aligned.editor).align("left");
    expect(aligned.save()).toBe(TASK);
  });
});

describe("Quote on a list inside a quote", () => {
  it.each([
    ["⌘⇧B on a word", { word: "word" } as Pick, "key" as const, undefined, "- item word\n\nNext.\n"],
    ["⌘⇧B at a caret, then typing", { caret: "word" } as Pick, "key" as const, "Hi", "- item wordHi\n\nNext.\n"],
    ["the toolbar's Quote", { word: "word" } as Pick, quote, undefined, "- item word\n\nNext.\n"],
  ])("%s removes the quote and keeps the list, in both modes", { timeout: 20_000 }, async (_, pick, act, typed, expected) => {
    expect(visual(QUOTED_LIST, pick, act, typed)).toBe(expected);
    expect(await code(QUOTED_LIST, pick, act, typed)).toBe(expected);
  });

  it("takes a whole quoted list out of the quote", { timeout: 20_000 }, async () => {
    const source = "> - one\n> - two word\n";
    expect(visual(source, { word: "word" }, quote)).toBe("- one\n- two word\n");
    expect(await code(source, { word: "word" }, quote)).toBe("- one\n- two word\n");
  });

  it("still lifts a quote out of a list item and keeps the item", { timeout: 20_000 }, async () => {
    const source = "- item\n\n  > quoted word\n";
    expect(visual(source, { word: "word" }, quote)).toBe("- item\n\n  quoted word\n");
    expect(await code(source, { word: "word" }, quote)).toBe("- item\n\n  quoted word\n");
  });
});

describe("Quote on a quote that opens a list item", () => {
  const ITEM: JSONContent = {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph" },
              { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "quoted word" }] }] },
            ],
          },
        ],
      },
    ],
  };

  it("lifts the quoted text into the item's first line", () => {
    const editor = new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, content: ITEM });
    opened.push(editor);
    const at = docPosition(editor, "word", false);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
    expect(toggleQuote(editor)).toBe(true);
    expect(serializeMarkdownBody(editor.getJSON())).toBe("- quoted word");
  });
});
