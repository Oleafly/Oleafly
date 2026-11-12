// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TextSelection } from "@tiptap/pm/state";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { destroyKbEditors, kbEditor, kbMarkdown, placeCursor } from "./tests/kb-editor-fixtures";
import { ACTIVE_MATCH_CLASS, MATCH_CLASS, NoteFind, noteFindState } from "./note-find";
import { isFindKey, NoteFindBar } from "./NoteFindBar";

const copy = enEditor.package.search;

afterEach(() => {
  destroyKbEditors();
});

function mount(markdown: string, { editable = true } = {}) {
  const editor = kbEditor(markdown, { callout: null }, [NoteFind]);
  editor.setEditable(editable);
  const scope = createRef<HTMLDivElement>();
  const view = render(
    <div ref={scope} data-testid="scope">
      <NoteFindBar editor={editor} scope={scope} />
    </div>,
  );
  const host = editor.view.dom.parentElement;
  if (host) screen.getByTestId("scope").append(host);
  return { editor, view };
}

function press(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(event));
  return event;
}

function findField(): HTMLInputElement {
  return screen.getByRole("textbox", { name: copy.find }) as HTMLInputElement;
}

function count(): string {
  return screen.getByRole("status").textContent ?? "";
}

describe("isFindKey", () => {
  it("takes Ctrl+F off macOS, including the F key on other layouts, and nothing with extra modifiers", () => {
    const key = (init: KeyboardEventInit) => isFindKey(new KeyboardEvent("keydown", init));
    expect(key({ key: "f", ctrlKey: true })).toBe(true);
    expect(key({ key: "F", ctrlKey: true })).toBe(true);
    expect(key({ key: "а", code: "KeyF", ctrlKey: true })).toBe(true);
    expect(key({ key: "f", metaKey: true })).toBe(false);
    expect(key({ key: "f", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(key({ key: "f", ctrlKey: true, altKey: true })).toBe(false);
    expect(key({ key: "g", code: "KeyF", ctrlKey: true })).toBe(false);
  });
});

describe("NoteFindBar", () => {
  it("opens on Ctrl+F from the note, seeded with the selected word, and counts matches", () => {
    const { editor } = mount("alpha beta alpha gamma alpha");
    expect(screen.queryByRole("search")).toBeNull();
    const at = placeCursor(editor, "beta");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at, at + 4)));
    const opened = press(editor.view.dom, { key: "f", ctrlKey: true });
    expect(opened.defaultPrevented).toBe(true);
    expect(screen.getByRole("search", { name: copy.panel })).toBeInTheDocument();
    expect(findField()).toHaveValue("beta");
    expect(findField()).toHaveFocus();
    expect(count()).toBe("1 of 1");
    fireEvent.change(findField(), { target: { value: "alpha" } });
    expect(count()).toBe("3 results");
    expect(editor.view.dom.querySelectorAll(`.${MATCH_CLASS}`)).toHaveLength(3);
  });

  it("steps with Enter and Shift+Enter and the arrows, and ignores Enter that ends an IME composition", () => {
    const { editor } = mount("one two one two one");
    press(editor.view.dom, { key: "f", ctrlKey: true });
    fireEvent.change(findField(), { target: { value: "one" } });
    fireEvent.keyDown(findField(), { key: "Enter" });
    expect(count()).toBe("1 of 3");
    fireEvent.keyDown(findField(), { key: "Enter" });
    expect(count()).toBe("2 of 3");
    fireEvent.keyDown(findField(), { key: "Enter", shiftKey: true });
    expect(count()).toBe("1 of 3");
    fireEvent.keyDown(findField(), { key: "Enter", keyCode: 229 });
    expect(count()).toBe("1 of 3");
    fireEvent.click(screen.getByRole("button", { name: copy.previousMatch }));
    expect(count()).toBe("3 of 3");
    fireEvent.click(screen.getByRole("button", { name: copy.nextMatch }));
    expect(count()).toBe("1 of 3");
    expect(editor.view.dom.querySelectorAll(`.${ACTIVE_MATCH_CLASS}`)).toHaveLength(1);
  });

  it("toggles case, whole word and regular expression matching", () => {
    const { editor } = mount("Cat cat cats c4t");
    press(editor.view.dom, { key: "f", ctrlKey: true });
    fireEvent.change(findField(), { target: { value: "cat" } });
    expect(count()).toBe("3 results");
    fireEvent.click(screen.getByRole("button", { name: copy.matchCase }));
    expect(screen.getByRole("button", { name: copy.matchCase })).toHaveAttribute("aria-pressed", "true");
    expect(count()).toBe("2 results");
    fireEvent.click(screen.getByRole("button", { name: copy.matchWholeWord }));
    expect(count()).toBe("1 result");
    fireEvent.change(findField(), { target: { value: "c[a4]t" } });
    expect(count()).toBe(copy.noResults);
    fireEvent.click(screen.getByRole("button", { name: copy.useRegex }));
    expect(count()).toBe("2 results");
    fireEvent.change(findField(), { target: { value: "c[" } });
    expect(count()).toBe(copy.invalid);
  });

  it("closes on Escape, clears the marks and returns to the note, but not while an IME is composing", () => {
    const { editor } = mount("word word");
    press(editor.view.dom, { key: "f", ctrlKey: true });
    fireEvent.change(findField(), { target: { value: "word" } });
    fireEvent.keyDown(findField(), { key: "Escape", isComposing: true });
    expect(screen.getByRole("search")).toBeInTheDocument();
    const closing = press(findField(), { key: "Escape" });
    expect(closing.defaultPrevented).toBe(true);
    expect(screen.queryByRole("search")).toBeNull();
    expect(noteFindState(editor.state).query).toBeNull();
    expect(editor.view.dom.querySelector(`.${MATCH_CLASS}`)).toBeNull();
    press(editor.view.dom, { key: "f", ctrlKey: true });
    expect(findField()).toHaveValue("word");
    fireEvent.click(screen.getByRole("button", { name: copy.close }));
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("replaces the next match and all matches from the replace row", () => {
    const { editor } = mount("red one, red two, red three");
    press(editor.view.dom, { key: "f", ctrlKey: true });
    fireEvent.change(findField(), { target: { value: "red" } });
    const toggle = screen.getByRole("button", { name: copy.toggleReplace });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const field = screen.getByRole("textbox", { name: copy.replace });
    fireEvent.change(field, { target: { value: "blue" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(kbMarkdown(editor)).toBe("blue one, red two, red three");
    fireEvent.click(screen.getByRole("button", { name: copy.replaceAllAction }));
    expect(kbMarkdown(editor)).toBe("blue one, blue two, blue three");
    expect(count()).toBe(copy.noResults);
  });

  it("keeps the case of each match when asked", () => {
    const { editor } = mount("Red red RED");
    press(editor.view.dom, { key: "f", ctrlKey: true });
    fireEvent.change(findField(), { target: { value: "red" } });
    fireEvent.click(screen.getByRole("button", { name: copy.toggleReplace }));
    fireEvent.change(screen.getByRole("textbox", { name: copy.replace }), { target: { value: "blue" } });
    fireEvent.click(screen.getByRole("button", { name: copy.preserveCase }));
    fireEvent.click(screen.getByRole("button", { name: copy.replaceAllAction }));
    expect(kbMarkdown(editor)).toBe("Blue blue BLUE");
  });

  it("offers no replacing in a read-only note", () => {
    const { editor } = mount("shared text", { editable: false });
    press(editor.view.dom.parentElement as HTMLElement, { key: "f", ctrlKey: true });
    fireEvent.change(findField(), { target: { value: "text" } });
    expect(count()).toBe("1 result");
    expect(screen.queryByRole("button", { name: copy.toggleReplace })).toBeNull();
    expect(screen.queryByRole("textbox", { name: copy.replace })).toBeNull();
  });

  it("scrolls a match into the middle only when it is out of view or under the bar", () => {
    const { editor } = mount("first\n\nsecond");
    press(editor.view.dom, { key: "f", ctrlKey: true });
    fireEvent.change(findField(), { target: { value: "second" } });
    const scrolled: ScrollIntoViewOptions[] = [];
    const place = (top: number) => {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value(options: ScrollIntoViewOptions) {
          scrolled.push(options);
        },
      });
      const scope = screen.getByTestId("scope");
      scope.getBoundingClientRect = () => ({ top: 0, bottom: 400 }) as DOMRect;
      screen.getByRole("search").getBoundingClientRect = () => ({ bottom: 60 }) as DOMRect;
      const original = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
        return this.classList.contains(ACTIVE_MATCH_CLASS) ? ({ top, bottom: top + 20 } as DOMRect) : original.call(this);
      };
      return () => {
        HTMLElement.prototype.getBoundingClientRect = original;
      };
    };
    let restore = place(200);
    fireEvent.click(screen.getByRole("button", { name: copy.nextMatch }));
    restore();
    expect(scrolled).toEqual([]);
    restore = place(30);
    fireEvent.click(screen.getByRole("button", { name: copy.previousMatch }));
    restore();
    restore = place(900);
    fireEvent.click(screen.getByRole("button", { name: copy.nextMatch }));
    restore();
    expect(scrolled).toEqual([
      { block: "center", inline: "nearest" },
      { block: "center", inline: "nearest" },
    ]);
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView;
  });

  it("clears the marks when it unmounts with the bar open", () => {
    const { editor, view } = mount("keep keep");
    press(editor.view.dom, { key: "f", ctrlKey: true });
    fireEvent.change(findField(), { target: { value: "keep" } });
    expect(noteFindState(editor.state).matches).toHaveLength(2);
    view.unmount();
    expect(noteFindState(editor.state).query).toBeNull();
  });
});
