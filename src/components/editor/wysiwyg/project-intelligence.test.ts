// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { ProjectIntelligenceSnapshot } from "@/lib/project-intelligence/types";

const mocks = vi.hoisted(() => ({
  current: vi.fn(),
  showLookupResult: vi.fn(),
  explainMissingAnalysis: vi.fn(() => true),
  navigate: vi.fn(async () => {}),
  showReferences: vi.fn(),
  setRailTab: vi.fn(),
}));

vi.mock("@/lib/project-intelligence/current", () => ({
  currentProjectIntelligence: mocks.current,
}));
vi.mock("@/lib/index/nav", () => ({
  showLookupResult: mocks.showLookupResult,
  explainMissingAnalysis: mocks.explainMissingAnalysis,
}));
vi.mock("@/lib/project-intelligence/navigation", () => ({
  navigateToProjectRange: mocks.navigate,
}));
vi.mock("@/store/references", () => ({
  useReferencesStore: { getState: () => ({ show: mocks.showReferences }) },
}));
vi.mock("@/store/settings", () => ({
  useSettingsStore: {
    getState: () => ({
      setRailTab: mocks.setRailTab,
      showTree: true,
      toggleTree: vi.fn(),
    }),
  },
}));

import { useToastStore } from "@/store/toast";
import { VisualProjectIntelligence } from "./project-intelligence";

const RANGE = {
  from: 0,
  to: 5,
  startLine: 1,
  startColumn: 0,
  endLine: 1,
  endColumn: 5,
};

function definition(id: string, name: string) {
  return {
    id,
    source: "local",
    engine: "markdown",
    kind: "bibentry",
    name,
    location: { file: "refs.bib", range: RANGE },
  };
}

const SNAPSHOT = {
  identity: { projectId: "project", projectRevision: 1, requestGeneration: 1 },
  definitions: [
    definition("def:knuth", "knuth"),
    definition("def:dup-a", "dup"),
    definition("def:dup-b", "dup"),
  ],
  uses: [],
} as unknown as ProjectIntelligenceSnapshot;

const PARAGRAPH = "See @knuth and @missing and @dup";

let editors: Editor[] = [];

function mount(): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit, VisualProjectIntelligence],
    content: `<p>${PARAGRAPH}</p>`,
    editorProps: { handleScrollToSelection: () => true },
  });
  editors.push(editor);
  return editor;
}

function chip(editor: Editor, key: string): HTMLElement {
  const found = editor.view.dom.querySelector<HTMLElement>(
    `[data-project-intelligence-key="${key}"]`,
  );
  if (!found) throw new Error(`no chip for ${key}`);
  return found;
}

function click(target: HTMLElement, init: MouseEventInit = {}) {
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, ...init }),
  );
}

function press(editor: Editor, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  editor.view.dom.dispatchEvent(event);
  return event;
}

function caretAfter(editor: Editor, word: string) {
  editor.commands.setTextSelection(1 + PARAGRAPH.indexOf(word) + word.length);
}

function paragraphCount(editor: Editor): number {
  return editor.getJSON().content?.filter((node) => node.type === "paragraph").length ?? 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  useToastStore.getState().reset();
  mocks.current.mockReturnValue({ path: "main.md", snapshot: SNAPSHOT });
});

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  document.body.replaceChildren();
});

describe("visual project intelligence activation", () => {
  it("leaves an unresolved chip silent on a plain click, since the chip shows its state", () => {
    const editor = mount();
    const missing = chip(editor, "missing");
    expect(missing.className).toContain("is-unresolved");

    click(missing);

    expect(mocks.showLookupResult).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("opens the definition of a resolved chip once, even on a double click", () => {
    const editor = mount();
    const knuth = chip(editor, "knuth");

    click(knuth);
    click(knuth, { detail: 2 });

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ path: "refs.bib" }),
    );
  });

  it("keeps the duplicate explanation and opens References for a chip with several definitions", () => {
    const editor = mount();
    const duplicate = chip(editor, "dup");

    click(duplicate);
    click(duplicate, { detail: 2 });

    expect(mocks.showLookupResult).toHaveBeenCalledTimes(1);
    expect(mocks.showLookupResult).toHaveBeenCalledWith(
      "“dup” has 2 definitions. Open References to inspect them.",
    );
    expect(mocks.setRailTab).toHaveBeenCalledWith("refs");
  });

  it("finds references on a shift click, as the chip title says", () => {
    const editor = mount();

    click(chip(editor, "knuth"), { shiftKey: true });

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.showLookupResult).toHaveBeenCalledExactlyOnceWith(
      "No references to “knuth”.",
    );
  });

  it("finds references with Shift+Enter on a focused chip", () => {
    const editor = mount();
    const knuth = chip(editor, "knuth");
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    knuth.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(mocks.showLookupResult).toHaveBeenCalledExactlyOnceWith(
      "No references to “knuth”.",
    );
    expect(paragraphCount(editor)).toBe(1);
  });

  it("lets Enter and Shift+Enter edit text next to a citation", () => {
    const editor = mount();
    caretAfter(editor, "@missing");

    press(editor, { key: "Enter" });
    expect(paragraphCount(editor)).toBe(2);

    press(editor, { key: "Enter", shiftKey: true });
    expect(editor.getJSON().content?.[1]?.content?.[0]?.type).toBe("hardBreak");

    expect(mocks.showLookupResult).not.toHaveBeenCalled();
    expect(mocks.explainMissingAnalysis).not.toHaveBeenCalled();
  });

  it("answers F12 on an unresolved citation and ignores key repeat", () => {
    const editor = mount();
    caretAfter(editor, "@missing");

    const first = press(editor, { key: "F12" });
    press(editor, { key: "F12", repeat: true });

    expect(first.defaultPrevented).toBe(true);
    expect(mocks.showLookupResult).toHaveBeenCalledTimes(1);
    expect(mocks.showLookupResult).toHaveBeenCalledWith(
      "No definition found for “missing”.",
    );
  });

  it("answers Shift+F12 when a citation has no references", () => {
    const editor = mount();
    caretAfter(editor, "@knuth");

    press(editor, { key: "F12", shiftKey: true });

    expect(mocks.showLookupResult).toHaveBeenCalledWith(
      "No references to “knuth”.",
    );
  });

  it("explains a lookup made before analysis catches up with an edit", () => {
    const editor = mount();
    caretAfter(editor, "@knuth");
    editor.commands.insertContent("x");
    caretAfter(editor, "@missing");

    press(editor, { key: "F12" });

    expect(mocks.explainMissingAnalysis).toHaveBeenCalledWith(undefined, true);
    expect(mocks.showLookupResult).not.toHaveBeenCalled();
  });

  it("stays silent on a click while analysis is unavailable", () => {
    const editor = mount();
    const knuth = chip(editor, "knuth");
    mocks.current.mockReturnValue(null);

    click(knuth);

    expect(mocks.explainMissingAnalysis).not.toHaveBeenCalled();
    expect(mocks.showLookupResult).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
