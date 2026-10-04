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
const settingsState = vi.hoisted(() => ({ showTree: true, toggleTree: vi.fn() }));

vi.mock("@/store/settings", () => ({
  useSettingsStore: {
    getState: () => ({
      setRailTab: mocks.setRailTab,
      showTree: settingsState.showTree,
      toggleTree: settingsState.toggleTree,
    }),
  },
}));

import { RawInline } from "@oleafly/wysiwyg";
import { useToastStore } from "@/store/toast";
import { getWysiwygProjectIntelligenceCurrent } from "./controller";
import {
  findVisualReferences,
  goToVisualDefinition,
  refreshVisualProjectIntelligence,
  VisualProjectIntelligence,
} from "./project-intelligence";

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

describe("visual project intelligence in richer documents", () => {
  function anchor(id: string, name: string) {
    return {
      id,
      source: "local",
      engine: "markdown",
      kind: "anchor",
      name,
      location: { file: "main.md", range: { ...RANGE, from: 40, to: 45 } },
    };
  }

  function use(id: string, kind: string, name: string, resolution: string, definitionIds: string[], from: number) {
    return {
      id,
      source: "local",
      engine: "markdown",
      kind,
      name,
      location: { file: "main.md", range: { ...RANGE, from, to: from + 5 } },
      resolution,
      definitionIds,
    };
  }

  const RICH = {
    identity: { projectId: "project", projectRevision: 2, requestGeneration: 1 },
    definitions: [
      definition("def:knuth", "knuth"),
      definition("def:dup-a", "dup"),
      definition("def:dup-b", "dup"),
      anchor("def:intro", "intro"),
    ],
    uses: [
      use("use:knuth-stale", "citation", "knuth", "unresolved", [], 5),
      use("use:knuth", "citation", "knuth", "resolved", ["def:knuth"], 10),
      use("use:dup", "citation", "dup", "duplicate", ["def:dup-a", "def:dup-b"], 20),
      use("use:ghost", "reference", "intro", "resolved", ["def:gone", "def:intro"], 30),
      use("use:phantom", "citation", "phantom", "unresolved", ["def:gone"], 50),
    ],
  } as unknown as ProjectIntelligenceSnapshot;

  const CONTENT = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "See " },
          { type: "rawInline", attrs: { source: String.raw`\cite{knuth,missing}` } },
          { type: "text", text: " and " },
          { type: "text", text: "Intro", marks: [{ type: "link", attrs: { href: "#intro" } }] },
          { type: "text", text: " or " },
          { type: "text", text: "top", marks: [{ type: "link", attrs: { href: "#" } }] },
          { type: "text", text: " then " },
          { type: "text", text: "@knuth", marks: [{ type: "code" }] },
          { type: "text", text: " plus @dup and @phantom end" },
        ],
      },
    ],
  };

  function mountRich(): Editor {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: [StarterKit, RawInline, VisualProjectIntelligence],
      content: CONTENT,
      editorProps: { handleScrollToSelection: () => true },
    });
    editors.push(editor);
    return editor;
  }

  function positionOfText(editor: Editor, needle: string): number {
    let found = -1;
    editor.state.doc.descendants((node, position) => {
      if (found < 0 && node.isText && node.text?.includes(needle)) {
        found = position + node.text.indexOf(needle);
      }
      return found < 0;
    });
    if (found < 0) throw new Error(`no text ${needle}`);
    return found;
  }

  function positionOfRawInline(editor: Editor): number {
    let found = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "rawInline") found = position;
      return found < 0;
    });
    return found;
  }

  beforeEach(() => {
    settingsState.showTree = true;
    mocks.current.mockReturnValue({ path: "main.md", snapshot: RICH });
  });

  it("marks a raw citation by its weakest key and records every key", () => {
    const editor = mountRich();
    const raw = editor.view.dom.querySelector<HTMLElement>("[data-project-intelligence-token-states]");
    expect(raw?.dataset.projectIntelligenceKey).toBe("missing");
    expect(raw?.className).toContain("is-unresolved");
    const states = JSON.parse(raw?.dataset.projectIntelligenceTokenStates ?? "[]") as { key: string; resolution: string }[];
    expect(states.map(({ key, resolution }) => [key, resolution])).toEqual([
      ["knuth", "resolved"],
      ["missing", "unresolved"],
    ]);
  });

  it("marks heading links but not empty anchors or code", () => {
    const editor = mountRich();
    expect(chip(editor, "intro").className).toContain("is-resolved");
    expect(chip(editor, "intro").dataset.projectIntelligenceKind).toBe("reference");
    expect(editor.view.dom.querySelector('[data-project-intelligence-key=""]')).toBeNull();
    const inlineCode = [...editor.view.dom.querySelectorAll("code")].find((node) => node.textContent === "@knuth");
    expect(inlineCode).toBeDefined();
    expect(inlineCode?.closest("[data-project-intelligence-key]")).toBeNull();
    expect(inlineCode?.querySelector("[data-project-intelligence-key]")).toBeNull();
    expect(chip(editor, "dup").className).toContain("is-duplicate");
  });

  it("looks up the weakest key of a raw citation at the caret", () => {
    const editor = mountRich();
    editor.commands.setTextSelection(positionOfRawInline(editor));
    expect(findVisualReferences(editor)).toBe(true);
    expect(mocks.showLookupResult).toHaveBeenCalledWith("No definition found for “missing”.");
  });

  it("decorates nothing for files the visual mode cannot analyse", () => {
    mocks.current.mockReturnValue({ path: "main.typ", snapshot: RICH });
    const editor = mountRich();
    expect(editor.view.dom.querySelector("[data-project-intelligence-key]")).toBeNull();
  });

  it("opens the anchor behind a heading link with F12", () => {
    const editor = mountRich();
    editor.commands.setTextSelection(positionOfText(editor, "Intro") + 2);
    expect(goToVisualDefinition(editor)).toBe(true);
    expect(mocks.navigate).toHaveBeenCalledWith({
      path: "main.md",
      range: { ...RANGE, from: 40, to: 45 },
      source: "editor",
    });
  });

  it("lists the references to a heading anchor and opens the panel", () => {
    settingsState.showTree = false;
    const editor = mountRich();
    editor.commands.setTextSelection(positionOfText(editor, "Intro") + 1);
    expect(findVisualReferences(editor)).toBe(true);
    expect(mocks.showReferences).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "references", targetId: "def:intro", projectRevision: 2 }),
    );
    expect(mocks.setRailTab).toHaveBeenCalledWith("refs");
    expect(settingsState.toggleTree).toHaveBeenCalledOnce();
  });

  it("shows every definition of a duplicated key that has a use", () => {
    const editor = mountRich();
    click(chip(editor, "dup"));
    expect(mocks.showReferences).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "definitions", targetId: "use:dup" }),
    );
    expect(mocks.showLookupResult).not.toHaveBeenCalled();
  });

  it("explains a use whose definitions have gone", () => {
    const editor = mountRich();
    editor.commands.setTextSelection(positionOfText(editor, "@phantom") + 3);
    press(editor, { key: "F12" });
    expect(mocks.showLookupResult).toHaveBeenCalledWith("No definition found for “phantom”.");
  });

  it("answers nothing where the caret is not on a key", () => {
    const editor = mountRich();
    editor.commands.setTextSelection(positionOfText(editor, " end") + 2);
    expect(goToVisualDefinition(editor)).toBe(false);
    expect(findVisualReferences(editor)).toBe(false);
    expect(press(editor, { key: "F12" }).defaultPrevented).toBe(false);
  });

  it("uses the first raw key while analysis is unavailable and explains why", () => {
    const editor = mountRich();
    mocks.current.mockReturnValue(null);
    editor.commands.setTextSelection(positionOfRawInline(editor));
    expect(goToVisualDefinition(editor)).toBe(true);
    expect(mocks.explainMissingAnalysis).toHaveBeenCalledWith(undefined, false);
  });

  it("ignores Enter repeats on a focused chip and runs plain Enter as a click", () => {
    const editor = mountRich();
    const knuthChip = chip(editor, "intro");
    const repeat = new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true });
    knuthChip.dispatchEvent(repeat);
    expect(repeat.defaultPrevented).toBe(true);
    expect(mocks.navigate).not.toHaveBeenCalled();
    knuthChip.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(mocks.navigate).toHaveBeenCalledOnce();
  });

  it("publishes whether analysis is current and clears the edit flag on refresh", () => {
    const editor = mountRich();
    expect(getWysiwygProjectIntelligenceCurrent()).toBe(true);
    editor.commands.insertContentAt(1, "x");
    expect(getWysiwygProjectIntelligenceCurrent()).toBe(false);
    expect(editor.view.dom.querySelector("[data-project-intelligence-key]")).toBeNull();
    refreshVisualProjectIntelligence(editor, "rev-2");
    expect(getWysiwygProjectIntelligenceCurrent()).toBe(true);
    expect(editor.view.dom.querySelector("[data-project-intelligence-key]")).not.toBeNull();
    editor.destroy();
    editors = editors.filter((entry) => entry !== editor);
    expect(getWysiwygProjectIntelligenceCurrent()).toBe(false);
  });
});
