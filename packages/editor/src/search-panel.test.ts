// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import { vscodeSearch } from "./search-panel";

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
        vscodeSearch(),
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
});
