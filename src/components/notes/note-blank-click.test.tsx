// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { focusFromBlank } from "./NoteDocument";

function fakeEditor(found: { pos: number } | null = { pos: 7 }) {
  const run = vi.fn();
  const setTextSelection = vi.fn(() => ({ run }));
  const focusChain = vi.fn(() => ({ setTextSelection }));
  const editor = {
    view: {
      dom: { getBoundingClientRect: () => ({ top: 100, bottom: 300, left: 50, right: 450 }) },
      posAtCoords: vi.fn(() => found),
    },
    commands: { focus: vi.fn() },
    chain: vi.fn(() => ({ focus: focusChain })),
  };
  return { editor, run, setTextSelection, focusChain };
}

function mouse(target: HTMLElement, clientX: number, clientY: number, button = 0) {
  const preventDefault = vi.fn();
  return {
    event: { target, clientX, clientY, button, preventDefault } as unknown as MouseEvent,
    preventDefault,
  };
}

function blank(): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-note-blank", "");
  return element;
}

describe("clicking blank space around a note", () => {
  it("puts the caret at the end when the click lands below the text", () => {
    const { editor } = fakeEditor();
    const { event, preventDefault } = mouse(blank(), 200, 420);
    focusFromBlank(editor as unknown as Editor, event);
    expect(preventDefault).toHaveBeenCalled();
    expect(editor.commands.focus).toHaveBeenCalledWith("end");
  });

  it("puts the caret on the nearest line when the click lands beside the text", () => {
    const { editor, setTextSelection, run } = fakeEditor({ pos: 12 });
    const { event, preventDefault } = mouse(blank(), 10, 180);
    focusFromBlank(editor as unknown as Editor, event);
    expect(preventDefault).toHaveBeenCalled();
    expect(editor.view.posAtCoords).toHaveBeenCalledWith({ left: 51, top: 180 });
    expect(setTextSelection).toHaveBeenCalledWith(12);
    expect(run).toHaveBeenCalled();
  });

  it("clamps a click past the right edge onto the text column", () => {
    const { editor } = fakeEditor();
    focusFromBlank(editor as unknown as Editor, mouse(blank(), 900, 150).event);
    expect(editor.view.posAtCoords).toHaveBeenCalledWith({ left: 449, top: 150 });
  });

  it("falls back to the end when no position is found beside the text", () => {
    const { editor } = fakeEditor(null);
    focusFromBlank(editor as unknown as Editor, mouse(blank(), 10, 180).event);
    expect(editor.commands.focus).toHaveBeenCalledWith("end");
  });

  it("leaves clicks above the text, on content, or with other buttons alone", () => {
    const { editor } = fakeEditor();
    const above = mouse(blank(), 200, 40);
    focusFromBlank(editor as unknown as Editor, above.event);
    const content = mouse(document.createElement("p"), 200, 420);
    focusFromBlank(editor as unknown as Editor, content.event);
    const right = mouse(blank(), 200, 420, 2);
    focusFromBlank(editor as unknown as Editor, right.event);
    focusFromBlank(null, mouse(blank(), 200, 420).event);
    expect(above.preventDefault).not.toHaveBeenCalled();
    expect(content.preventDefault).not.toHaveBeenCalled();
    expect(right.preventDefault).not.toHaveBeenCalled();
    expect(editor.commands.focus).not.toHaveBeenCalled();
    expect(editor.chain).not.toHaveBeenCalled();
  });
});
