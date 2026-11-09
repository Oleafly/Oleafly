// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { destroyKbEditors, kbEditor, kbMarkdown, placeCursor, pressKey } from "./kb-test-editor";
import { NoteTagMenu } from "./NoteTagMenu";
import {
  closeTagMenu,
  docTags,
  insertTag,
  noteTagExtensions,
  tagCandidates,
  tagSuggestion,
  textblockText,
  type NoteTagOptions,
} from "./note-tag-chips";

beforeAll(async () => {
  await loadNamespace("notes");
});

afterEach(destroyKbEditors);

function build(markdown: string, overrides: Partial<NoteTagOptions> = {}) {
  let listener: (() => void) | null = null;
  const options: NoteTagOptions = {
    getTags: () => ["research", "reading", "ml/vision"],
    getOpenTag: () => null,
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    ...overrides,
  };
  const editor = kbEditor(markdown, { callout: null }, noteTagExtensions(options));
  return { editor, refresh: () => listener?.(), listening: () => listener !== null };
}

function type(editor: ReturnType<typeof build>["editor"], text: string) {
  act(() => {
    for (const char of text) {
      const { from, to } = editor.state.selection;
      editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    }
  });
}

describe("tag chips", () => {
  it("draws chips for tags in text and skips code, links and code blocks", () => {
    const { editor } = build("Plan #idea and `#code` and [#link](https://x.org) and #ml/vision\n\n```\n#fenced\n```");
    const chips = [...editor.view.dom.querySelectorAll<HTMLElement>(".note-tag")];
    expect(chips.map((chip) => chip.dataset.tag)).toEqual(["idea", "ml/vision"]);
    expect(chips[0].dataset.tooltip).toBeUndefined();
    expect(docTags(editor.state.doc).map((range) => range.tag)).toEqual(["idea", "ml/vision"]);
    expect(textblockText(editor.state.doc.child(0))).toContain("￼");
  });

  it("opens a tag on click when the workspace can filter", () => {
    const onOpenTag = vi.fn();
    const { editor } = build("Read #paper", { getOpenTag: () => onOpenTag });
    const chip = editor.view.dom.querySelector<HTMLElement>(".note-tag");
    expect(chip?.dataset.tooltip).toBe(enNotes.kb.tags.open);
    chip?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(onOpenTag).toHaveBeenCalledWith("paper");
    editor.view.dom.querySelector("p")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    chip?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 2 }));
    expect(onOpenTag).toHaveBeenCalledTimes(1);
  });

  it("redraws when told the tags changed and stops listening when destroyed", () => {
    let open: ((tag: string) => void) | null = null;
    const built = build("Read #paper", { getOpenTag: () => open });
    open = vi.fn();
    built.refresh();
    expect(built.editor.view.dom.querySelector<HTMLElement>(".note-tag")?.dataset.tooltip).toBe(enNotes.kb.tags.open);
    built.editor.destroy();
    expect(built.listening()).toBe(false);
  });
});

describe("tag suggestions", () => {
  it("ranks prefix matches first, drops duplicates and hides an exact single match", () => {
    expect(tagCandidates(["reading", "Research", "pre-read", "research"], "re")).toEqual(["reading", "Research", "pre-read"]);
    expect(tagCandidates(["reading"], "Reading")).toEqual([]);
    expect(tagCandidates(Array.from({ length: 12 }, (_, index) => `t${index}`), "t")).toHaveLength(8);
  });

  it("suggests vault and note tags while typing and inserts the choice", () => {
    const { editor } = build("Local #rare\n\nx");
    placeCursor(editor, "x", 1);
    type(editor, " #r");
    expect(tagSuggestion(editor.state)?.items).toEqual(["research", "reading", "rare"]);
    expect(pressKey(editor, "ArrowDown")).toBe(true);
    expect(pressKey(editor, "ArrowUp")).toBe(true);
    expect(pressKey(editor, "ArrowUp")).toBe(true);
    expect(tagSuggestion(editor.state)?.index).toBe(2);
    expect(pressKey(editor, "Enter")).toBe(true);
    expect(kbMarkdown(editor)).toBe("Local #rare\n\nx #rare ");
  });

  it("closes on Escape, ignores modifiers and stays out of code and links", () => {
    const { editor } = build("x");
    placeCursor(editor, "x", 1);
    type(editor, " #re");
    expect(pressKey(editor, "ArrowDown", { metaKey: true })).toBe(false);
    expect(pressKey(editor, "a")).toBe(false);
    expect(pressKey(editor, "Escape")).toBe(true);
    expect(tagSuggestion(editor.state)).toBeNull();
    type(editor, "a");
    expect(tagSuggestion(editor.state)).toBeNull();
    type(editor, " #rea");
    expect(tagSuggestion(editor.state)?.items).toEqual(["reading", "rea"]);
    act(() => closeTagMenu(editor.view));
    expect(insertTag(editor.view, 0)).toBe(false);

    const code = build("`co`");
    placeCursor(code.editor, "co", 1);
    type(code.editor, " #re");
    expect(tagSuggestion(code.editor.state)).toBeNull();
    const block = build("```\nx\n```");
    placeCursor(block.editor, "x", 1);
    type(block.editor, " #re");
    expect(tagSuggestion(block.editor.state)).toBeNull();
    const word = build("x");
    placeCursor(word.editor, "x", 1);
    type(word.editor, "#re");
    expect(tagSuggestion(word.editor.state)).toBeNull();
  });

  it("shows a listbox that inserts on click", () => {
    const { editor } = build("x");
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation(() => ({ left: 1, top: 1, bottom: 2, right: 0 }));
    render(<NoteTagMenu editor={editor} />);
    placeCursor(editor, "x", 1);
    type(editor, " (#ml");
    const menu = screen.getByRole("listbox", { name: enNotes.kb.tags.menu });
    expect(menu).toBeTruthy();
    fireEvent.mouseEnter(screen.getByRole("option", { name: "ml/vision" }));
    fireEvent.click(screen.getByRole("option", { name: "ml/vision" }));
    expect(kbMarkdown(editor)).toBe("x (#ml/vision ");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
