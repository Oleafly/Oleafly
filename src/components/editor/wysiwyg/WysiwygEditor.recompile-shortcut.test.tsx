// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { useFilesStore } from "@/store/files";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";
import { WysiwygEditor } from "./WysiwygEditor";

let lastEditor: Editor | null = null;

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      lastEditor = editor;
      return editor;
    },
  };
});

const MARKDOWN = "Hello world.\n";

// The visual editor turns what it cannot show as rich text into atom nodes
// with their own source inputs, and those inputs commit on Cmd/Ctrl+Enter.
// Raw blocks and raw inlines only come out of LaTeX, which the component
// still parses.
const LATEX_WITH_SOURCE_NODES = [
  "\\documentclass{article}",
  "\\begin{document}",
  "Hello world.",
  "",
  "\\begin{tikzpicture}",
  "\\draw (0,0) -- (1,1);",
  "\\end{tikzpicture}",
  "",
  "A \\mystery{x} here.",
  "",
  "\\[",
  "x^2",
  "\\]",
  "\\end{document}",
  "",
].join("\n");
const MARKDOWN_WITH_MATH = "A $y$ here.\n";

function editor(): Editor {
  if (!lastEditor) throw new Error("The visual editor did not mount.");
  return lastEditor;
}

function hardBreaks(): number {
  let count = 0;
  editor().state.doc.descendants((node) => {
    if (node.type.name === "hardBreak") count += 1;
  });
  return count;
}

function cursorAfter(text: string): void {
  let target = -1;
  editor().state.doc.descendants((node, pos) => {
    if (target < 0 && node.isText && node.text?.includes(text)) {
      target = pos + (node.text.indexOf(text) + text.length);
    }
  });
  if (target < 0) throw new Error(`"${text}" is not in the document.`);
  act(() => {
    editor().commands.setTextSelection(target);
  });
}

// jsdom's navigator.platform is "", so matchesShortcut and TipTap's keymap
// both read Mod as Ctrl here.
function pressEnter(
  modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {},
  target: HTMLElement = editor().view.dom,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function sourceOf(type: string): unknown {
  let source: unknown;
  editor().state.doc.descendants((node) => {
    if (node.type.name === type) source = node.attrs.source;
  });
  return source;
}

// Stands in for App.tsx's bubble-phase window listener, which owns the
// recompile chord.
let recompiles = 0;
function countRecompile(event: KeyboardEvent): void {
  if (matchesShortcut(event, useShortcutStore.getState().bindings.recompile)) recompiles += 1;
}

beforeEach(() => {
  lastEditor = null;
  recompiles = 0;
  window.addEventListener("keydown", countRecompile);
  useShortcutStore.getState().resetAll();
  useFilesStore.setState({
    projectId: null,
    activePath: "notes.md",
    files: { "notes.md": { content: MARKDOWN, dirty: false } },
  } as unknown as ReturnType<typeof useFilesStore.getState>);
});

afterEach(() => {
  cleanup();
  window.removeEventListener("keydown", countRecompile);
  useShortcutStore.getState().resetAll();
});

describe("recompile shortcut in the visual (TipTap) editor", () => {
  it("Cmd/Ctrl+Enter reaches the app's recompile handler without adding a line break", () => {
    render(<WysiwygEditor wysiwyg={true} />);
    cursorAfter("Hello");

    const event = pressEnter({ ctrlKey: true });

    expect(recompiles).toBe(1);
    expect(event.defaultPrevented).toBe(true);
    expect(hardBreaks()).toBe(0);
    expect(editor().getText()).toBe("Hello world.");
  });

  it.each([
    {
      type: "rawBlock",
      path: "main.tex",
      content: LATEX_WITH_SOURCE_NODES,
      open: ".raw-block-edit",
      input: ".raw-block-input",
      next: "\\begin{tikzpicture}\\draw (0,0) -- (2,2);\\end{tikzpicture}",
    },
    {
      type: "rawInline",
      path: "main.tex",
      content: LATEX_WITH_SOURCE_NODES,
      open: ".raw-inline-edit",
      input: ".raw-inline-input",
      next: "\\mystery{y}",
    },
    {
      type: "mathDisplay",
      path: "main.tex",
      content: LATEX_WITH_SOURCE_NODES,
      open: '[data-type="math-display"] .math-rendered',
      input: ".math-input",
      next: "\\[\ny^2\n\\]",
    },
    {
      type: "mathInline",
      path: "notes.md",
      content: MARKDOWN_WITH_MATH,
      open: '[data-type="math-inline"] .math-rendered',
      input: ".math-input",
      next: "$z$",
    },
  ])("Cmd/Ctrl+Enter still commits the $type source input", ({ type, path, content, open, input, next }) => {
    useFilesStore.setState({
      activePath: path,
      files: { [path]: { content, dirty: false } },
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    const { container } = render(<WysiwygEditor wysiwyg={true} />);
    const opener = container.querySelector<HTMLElement>(open);
    if (!opener) throw new Error(`No ${open} in the visual editor.`);
    act(() => {
      fireEvent.click(opener);
    });
    const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(input);
    if (!field) throw new Error(`${open} did not open ${input}.`);
    field.value = next;

    const event = pressEnter({ ctrlKey: true }, field);

    expect(event.defaultPrevented).toBe(true);
    expect(container.querySelector(input)).toBeNull();
    expect(sourceOf(type)).toBe(next);
  });

  it("still inserts a line break on Shift+Enter", () => {
    render(<WysiwygEditor wysiwyg={true} />);
    cursorAfter("Hello");

    pressEnter({ shiftKey: true });

    expect(recompiles).toBe(0);
    expect(hardBreaks()).toBe(1);
  });
});
