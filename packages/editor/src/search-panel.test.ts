// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import { vscodeSearch } from "./search-panel";
import { englishEditorMessage } from "./test-messages";

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function setup(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        vscodeSearch(englishEditorMessage),
      ],
    }),
  });
  expect(openSearchPanel(view)).toBe(true);
  return view;
}

function control<T extends HTMLElement>(label: string): T {
  const element = document.querySelector(`[aria-label="${label}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`missing search-panel control: ${label}`);
  }
  return element as T;
}

function fill(label: string, value: string): void {
  const input = control<HTMLInputElement>(label);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function click(label: string): void {
  control<HTMLButtonElement>(label).click();
}

function countText(): string {
  return document.querySelector(".cm-vs-count")?.textContent ?? "";
}

describe("VS Code-style search panel", () => {
  it("exposes accessible disclosure, toggle, status, and input semantics", () => {
    setup("Token token Tokenish");

    const panel = control<HTMLElement>("Find and replace");
    expect(panel).toHaveAttribute("role", "search");
    expect(control("Find")).toBeInstanceOf(HTMLInputElement);
    expect(control("Replace")).toBeInstanceOf(HTMLInputElement);

    const disclosure = control("Toggle Replace");
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    click("Toggle Replace");
    expect(disclosure).toHaveAttribute("aria-expanded", "true");

    for (const label of [
      "Match case",
      "Match whole word",
      "Use regular expression",
      "Preserve case",
    ]) {
      expect(control(label)).toHaveAttribute("aria-pressed", "false");
    }

    const status = document.querySelector(".cm-vs-count");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");

    const icons = document.querySelectorAll(".cm-vs-icon");
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon).toHaveAttribute("width", "14");
      expect(icon).toHaveAttribute("height", "14");
    }
  });

  it("combines case, whole-word, and regular-expression filtering", () => {
    setup("Token token Tokenish");
    fill("Find", "Token");
    expect(countText()).toBe("3 results");

    click("Match case");
    expect(control("Match case")).toHaveAttribute("aria-pressed", "true");
    expect(countText()).toBe("2 results");

    click("Match whole word");
    expect(control("Match whole word")).toHaveAttribute("aria-pressed", "true");
    expect(countText()).toBe("1 result");

    click("Match case");
    expect(countText()).toBe("2 results");
    click("Match whole word");
    click("Use regular expression");
    fill("Find", "Token(?:ish)?");
    expect(countText()).toBe("3 results");

    fill("Find", "[");
    expect(countText()).toBe("Invalid");
  });

  it("selects every match and closes from both the button and Escape", () => {
    const editor = setup("one two one");
    fill("Find", "one");
    click("Select all matches");
    expect(editor.state.selection.ranges).toHaveLength(2);
    expect(
      editor.state.selection.ranges.map((range) =>
        editor.state.sliceDoc(range.from, range.to),
      ),
    ).toEqual(["one", "one"]);

    click("Close (Esc)");
    expect(document.querySelector(".cm-vs-search")).toBeNull();

    expect(openSearchPanel(editor)).toBe(true);
    const input = control<HTMLInputElement>("Find");
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.querySelector(".cm-vs-search")).toBeNull();
  });

  it("preserves matched capitalization when replacing all whole-word matches", () => {
    const editor = setup("FOO Foo foo food");
    fill("Find", "foo");
    click("Match whole word");
    click("Toggle Replace");
    fill("Replace", "bar");
    click("Preserve case");
    expect(control("Preserve case")).toHaveAttribute("aria-pressed", "true");
    click("Replace all");
    expect(editor.state.doc.toString()).toBe("BAR Bar bar food");
    expect(countText()).toBe("No results");
  });

  it("navigates in both directions and replaces only the selected match", () => {
    const editor = setup("first target second target");
    fill("Find", "target");
    click("Next match (Enter)");
    const first = editor.state.selection.main;
    expect(editor.state.sliceDoc(first.from, first.to)).toBe("target");

    click("Next match (Enter)");
    const second = editor.state.selection.main;
    expect(second.from).not.toBe(first.from);
    click("Previous match (⇧Enter)");
    expect(editor.state.selection.main.from).toBe(first.from);

    click("Toggle Replace");
    fill("Replace", "changed");
    click("Replace next");
    expect(editor.state.doc.toString()).toBe("first changed second target");
  });

  it.each([
    ["an NFD document", "Na papíru.".normalize("NFD"), "papíru", "listu", "Na listu."],
    ["a ligature", "\uFB01nance", "finance", "money", "money"],
    ["an escaped newline query", "a\nb", "a\\nb", "c", "c"],
  ])("replaces the selected match on %s with preserve case on", (_label, doc, find, replace, expected) => {
    const editor = setup(doc);
    click("Toggle Replace");
    fill("Find", find);
    fill("Replace", replace);
    click("Preserve case");
    click("Replace next");
    click("Replace next");
    expect(editor.state.doc.toString()).toBe(expected);
  });

  it("keeps a cased replacement as typed for caseless matches", () => {
    const editor = setup("数据 and 数据");
    click("Toggle Replace");
    fill("Find", "数据");
    fill("Replace", "GPU");
    click("Preserve case");
    click("Replace all");
    expect(editor.state.doc.toString()).toBe("GPU and GPU");
  });

  it("unquotes escapes in the replacement with preserve case on", () => {
    const editor = setup("one two");
    click("Toggle Replace");
    fill("Find", " ");
    fill("Replace", "\\n");
    click("Preserve case");
    click("Replace all");
    expect(editor.state.doc.toString()).toBe("one\ntwo");
  });
});

describe("search panel keyboard and edge cases", () => {
  function key(label: string, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    control<HTMLInputElement>(label).dispatchEvent(event);
    return event;
  }

  it("moves between matches with Enter and Shift+Enter in the find field", () => {
    const editor = setup("a target b target c");
    fill("Find", "target");
    expect(key("Find", { key: "Enter" }).defaultPrevented).toBe(true);
    const first = editor.state.selection.main.from;
    key("Find", { key: "Enter" });
    expect(editor.state.selection.main.from).toBeGreaterThan(first);
    key("Find", { key: "Enter", shiftKey: true });
    expect(editor.state.selection.main.from).toBe(first);
    expect(countText()).toBe("1 of 2");
  });

  it("replaces with Enter and closes with Escape in the replace field", () => {
    const editor = setup("one target two");
    click("Toggle Replace");
    fill("Find", "target");
    fill("Replace", "thing");
    key("Find", { key: "Enter" });
    key("Replace", { key: "Enter" });
    expect(editor.state.doc.toString()).toBe("one thing two");
    key("Replace", { key: "a" });
    expect(document.querySelector(".cm-vs-search")).not.toBeNull();
    key("Replace", { key: "Escape" });
    expect(document.querySelector(".cm-vs-search")).toBeNull();
  });

  it("collapses the replace row again", () => {
    setup("text");
    const toggle = control<HTMLButtonElement>("Toggle Replace");
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("caps the reported match count", () => {
    setup("x ".repeat(2_100));
    fill("Find", "x");
    expect(countText()).toBe("2000+ results");
  });

  it("does nothing on replace when the selection is not a match and with preserve case on an empty query", () => {
    const editor = setup("alpha beta");
    click("Toggle Replace");
    fill("Find", "beta");
    fill("Replace", "gamma");
    click("Preserve case");
    click("Replace next");
    expect(editor.state.doc.toString()).toBe("alpha beta");
    click("Replace next");
    expect(editor.state.doc.toString()).toBe("alpha gamma");
    fill("Find", "");
    click("Replace all");
    expect(editor.state.doc.toString()).toBe("alpha gamma");
  });

  it("replaces with regular expressions without preserving case", () => {
    const editor = setup("Cat cat");
    click("Toggle Replace");
    click("Use regular expression");
    fill("Find", "c.t");
    fill("Replace", "dog");
    click("Preserve case");
    click("Replace all");
    expect(editor.state.doc.toString()).toBe("dog dog");
  });
});

describe("scrolling to a match", () => {
  const LINE_HEIGHT = 20;
  const doc = Array.from({ length: 120 }, (_, index) =>
    index % 40 === 0 ? "\\begin{equation}" : `line ${index + 1}`,
  ).join("\n");

  function recordScrolls(editor: EditorView): Array<string | undefined> {
    const scrolls: Array<string | undefined> = [];
    const listener = EditorView.updateListener.of((update) => {
      for (const transaction of update.transactions) {
        for (const effect of transaction.effects) {
          const value = effect.value as { range?: unknown; y?: string } | null;
          if (value?.range !== undefined && "y" in value) scrolls.push(value.y);
        }
      }
    });
    editor.dispatch({ effects: StateEffect.appendConfig.of(listener) });
    return scrolls;
  }

  function showLines(editor: EditorView, firstLine: number, lastLine: number): void {
    vi.spyOn(editor.scrollDOM, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, (firstLine - 1) * LINE_HEIGHT, 400, (lastLine - firstLine + 1) * LINE_HEIGHT),
    );
    vi.spyOn(editor, "documentTop", "get").mockReturnValue(0);
    vi.spyOn(editor, "lineBlockAt").mockImplementation((pos) => {
      const line = editor.state.doc.lineAt(pos);
      const top = (line.number - 1) * LINE_HEIGHT;
      return { from: line.from, to: line.to, top, bottom: top + LINE_HEIGHT, height: LINE_HEIGHT } as never;
    });
  }

  function currentLine(editor: EditorView): number {
    return editor.state.doc.lineAt(editor.state.selection.main.head).number;
  }

  it("centers a match that is off screen and leaves a visible one where it is", () => {
    const editor = setup(doc);
    const scrolls = recordScrolls(editor);
    showLines(editor, 1, 60);
    fill("Find", "\\begin{equation}");

    click("Next match (Enter)");
    expect(currentLine(editor)).toBe(1);
    click("Next match (Enter)");
    expect(currentLine(editor)).toBe(41);
    click("Next match (Enter)");
    expect(currentLine(editor)).toBe(81);
    showLines(editor, 70, 100);
    click("Previous match (⇧Enter)");
    expect(currentLine(editor)).toBe(41);

    expect(scrolls).toEqual(["nearest", "nearest", "center", "center"]);
  });

  it("leaves a visible match in a long wrapped paragraph where it is", () => {
    const paragraph = Array.from({ length: 60 }, (_, index) => (index === 30 ? "target" : "word")).join(" ");
    const editor = setup(`intro\n${paragraph}\noutro`);
    const scrolls = recordScrolls(editor);
    vi.spyOn(editor.scrollDOM, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 400, 200));
    vi.spyOn(editor, "documentTop", "get").mockReturnValue(0);
    vi.spyOn(editor, "lineBlockAt").mockImplementation((pos) => {
      const line = editor.state.doc.lineAt(pos);
      const top = line.number === 1 ? 0 : line.number === 2 ? LINE_HEIGHT : 30 * LINE_HEIGHT;
      const height = line.number === 2 ? 29 * LINE_HEIGHT : LINE_HEIGHT;
      return { from: line.from, to: line.to, top, bottom: top + height, height } as never;
    });
    const coords = vi.spyOn(editor, "coordsAtPos").mockImplementation(() => ({ left: 0, right: 0, top: 180, bottom: 200 }));
    fill("Find", "target");
    click("Next match (Enter)");
    expect(coords).toHaveBeenCalled();
    coords.mockImplementation(() => ({ left: 0, right: 0, top: 500, bottom: 520 }));
    click("Previous match (⇧Enter)");
    expect(scrolls).toEqual(["nearest", "center"]);
  });
});
