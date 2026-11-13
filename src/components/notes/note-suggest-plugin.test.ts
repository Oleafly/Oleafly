// @vitest-environment jsdom

import { Schema } from "@tiptap/pm/model";
import { EditorState, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, EditorView } from "@tiptap/pm/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sendSuggestMeta,
  suggestionKey,
  suggestOptionId,
  suggestPlugin,
  type SuggestKeys,
  type SuggestPluginConfig,
  type SuggestRange,
  type SuggestState,
} from "./note-suggest-plugin";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] },
    text: {},
  },
});

const MENU = "mention-menu";
const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.remove();
    view.destroy();
  }
});

function mentionTrigger(state: EditorState): Omit<SuggestRange, "index"> | null {
  const { $from, empty } = state.selection;
  if (!empty) return null;
  const match = /@(\w*)$/u.exec($from.parent.textBetween(0, $from.parentOffset));
  if (!match) return null;
  return { from: $from.pos - match[0].length, to: $from.pos, query: match[1] };
}

interface Harness {
  view: EditorView;
  key: PluginKey<SuggestState<SuggestRange>>;
  chosen: string[];
  suggest: () => SuggestRange | null;
  press: (key: string, init?: KeyboardEventInit & { keyCode?: number }) => boolean;
  type: (text: string) => void;
}

function mount(
  overrides: Partial<SuggestPluginConfig<SuggestRange>> = {},
  options: { count?: number; text?: string; paragraphs?: string[] } = {},
): Harness {
  const key = new PluginKey<SuggestState<SuggestRange>>(`mention-${views.length}`);
  const chosen: string[] = [];
  const count = options.count ?? 3;
  const keysFor = (view: EditorView): SuggestKeys | null => {
    const suggest = key.getState(view.state)?.suggest;
    if (!suggest) return null;
    return {
      count,
      index: suggest.index,
      close: () => sendSuggestMeta(view, key, { dismiss: true }),
      highlight: (index) => sendSuggestMeta(view, key, { index }),
      choose: (event) => {
        chosen.push(`${suggest.query}:${suggest.index}:${event.key}`);
        return suggest.query !== "nothing";
      },
    };
  };
  const plugin = suggestPlugin<SuggestRange>({
    key,
    menuId: MENU,
    spec: {},
    trigger: mentionTrigger,
    options: (state) => {
      const suggest = key.getState(state)?.suggest;
      return suggest ? { index: suggest.index, count } : null;
    },
    handleKeyDown: (view, event) => suggestionKey(event, keysFor(view)),
    ...overrides,
  });
  const texts = options.paragraphs ?? [options.text ?? ""];
  const doc = schema.node(
    "doc",
    null,
    texts.map((text) => schema.node("paragraph", null, text ? [schema.text(text)] : [])),
  );
  const element = document.createElement("div");
  document.body.append(element);
  const view = new EditorView(element, { state: EditorState.create({ doc, plugins: [plugin] }) });
  views.push(view);
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  return {
    view,
    key,
    chosen,
    suggest: () => key.getState(view.state)?.suggest ?? null,
    press: (name, init = {}) => {
      const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
      if (init.keyCode !== undefined) Object.defineProperty(event, "keyCode", { value: init.keyCode });
      return view.someProp("handleKeyDown", (handler) => handler(view, event)) ?? false;
    },
    type: (text) => {
      for (const char of text) view.dispatch(view.state.tr.insertText(char));
    },
  };
}

describe("suggestion menus in the note editor", () => {
  it("opens while the cursor follows the trigger and closes when it leaves", () => {
    const editor = mount({}, { text: "See " });
    expect(editor.suggest()).toBeNull();
    expect(editor.view.dom).not.toHaveAttribute("aria-expanded");
    editor.type("@ma");
    expect(editor.suggest()).toEqual({ from: 5, to: 8, query: "ma", index: 0 });
    expect(editor.view.dom).toHaveAttribute("aria-controls", MENU);
    expect(editor.view.dom).toHaveAttribute("aria-expanded", "true");
    expect(editor.view.dom).toHaveAttribute("aria-activedescendant", suggestOptionId(MENU, 0));
    editor.type(" ");
    expect(editor.suggest()).toBeNull();
    expect(editor.view.dom).not.toHaveAttribute("aria-controls");
    expect(editor.view.dom).not.toHaveAttribute("aria-activedescendant");
  });

  it("moves the highlight with the arrow keys, wrapping at both ends", () => {
    const editor = mount();
    editor.type("@");
    expect(editor.press("ArrowDown")).toBe(true);
    expect(editor.suggest()?.index).toBe(1);
    expect(editor.view.dom).toHaveAttribute("aria-activedescendant", suggestOptionId(MENU, 1));
    editor.press("ArrowUp");
    editor.press("ArrowUp");
    expect(editor.suggest()?.index).toBe(2);
    editor.press("ArrowDown");
    expect(editor.suggest()?.index).toBe(0);
  });

  it("keeps the highlight while the query stays and starts over when the query changes", () => {
    const editor = mount();
    editor.type("@ab");
    editor.press("ArrowDown");
    editor.view.dispatch(editor.view.state.tr.setMeta("other", true).setSelection(TextSelection.atEnd(editor.view.state.doc)));
    expect(editor.suggest()?.index).toBe(1);
    editor.type("c");
    expect(editor.suggest()).toMatchObject({ query: "abc", index: 0 });
  });

  it("chooses with Enter or Tab and lets the key through when nothing was chosen", () => {
    const editor = mount();
    editor.type("@ab");
    editor.press("ArrowDown");
    expect(editor.press("Enter")).toBe(true);
    expect(editor.press("Tab")).toBe(true);
    expect(editor.chosen).toEqual(["ab:1:Enter", "ab:1:Tab"]);
    const other = mount();
    other.type("@nothing");
    expect(other.press("Enter")).toBe(false);
  });

  it("leaves shortcuts, other keys and IME composition to the editor", () => {
    const editor = mount();
    editor.type("@ab");
    expect(editor.press("ArrowDown", { ctrlKey: true })).toBe(false);
    expect(editor.press("Enter", { metaKey: true })).toBe(false);
    expect(editor.press("Enter", { altKey: true })).toBe(false);
    expect(editor.press("Enter", { isComposing: true })).toBe(false);
    expect(editor.press("Enter", { keyCode: 229 })).toBe(false);
    expect(editor.press("a")).toBe(false);
    expect(editor.chosen).toEqual([]);
    expect(editor.suggest()?.index).toBe(0);
  });

  it("keeps Escape working but ignores arrows when there is nothing to pick", () => {
    const editor = mount({}, { count: 0 });
    editor.type("@zz");
    expect(editor.view.dom).toHaveAttribute("aria-expanded", "true");
    expect(editor.view.dom).not.toHaveAttribute("aria-activedescendant");
    expect(editor.press("ArrowDown")).toBe(false);
    expect(editor.press("Enter")).toBe(false);
    expect(editor.press("Escape")).toBe(true);
    expect(editor.suggest()).toBeNull();
  });

  it("stays closed after Escape, even when text is typed before the trigger, until a new trigger starts", () => {
    const editor = mount({}, { text: "x " });
    editor.type("@ab");
    expect(editor.press("Escape")).toBe(true);
    expect(editor.suggest()).toBeNull();
    editor.type("c");
    expect(editor.suggest()).toBeNull();
    editor.view.dispatch(editor.view.state.tr.insertText("Hi ", 1));
    expect(editor.suggest()).toBeNull();
    editor.type(" ");
    editor.type("@d");
    expect(editor.suggest()).toMatchObject({ query: "d", index: 0 });
  });

  it("decorates text blocks, redraws the ones an edit touches and refreshes when its source changes", () => {
    let round = 1;
    let notify: () => void = () => {};
    const stop = vi.fn();
    const decorator = vi.fn(() => (block: { nodeSize: number }, pos: number) => [
      Decoration.node(pos, pos + block.nodeSize, { class: `round-${round}` }),
    ]);
    const editor = mount({
      decorator,
      subscribe: (listener) => {
        notify = listener;
        return stop;
      },
    }, { paragraphs: ["One", "Two"] });
    const paragraphs = () => [...editor.view.dom.querySelectorAll("p")].map((paragraph) => paragraph.className);
    expect(paragraphs()).toEqual(["round-1", "round-1"]);
    round = 2;
    editor.type("!");
    expect(paragraphs()).toEqual(["round-1", "round-2"]);
    round = 3;
    notify();
    expect(paragraphs()).toEqual(["round-3", "round-3"]);
    editor.view.destroy();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("redraws once after mounting when the view says its decorations are stale", async () => {
    let round = 1;
    const editor = mount({
      decorator: () => (block, pos) => [Decoration.node(pos, pos + block.nodeSize, { class: `round-${round}` })],
      redecorates: () => round === 1,
    }, { text: "One" });
    round = 2;
    await Promise.resolve();
    expect(editor.view.dom.querySelector("p")).toHaveClass("round-2");
  });

  it("passes clicks to the menu's own handler", () => {
    const click = vi.fn(() => true);
    const editor = mount({ click });
    editor.view.dom.querySelector("p")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(click).toHaveBeenCalledWith(editor.view, expect.any(MouseEvent));
  });
});
