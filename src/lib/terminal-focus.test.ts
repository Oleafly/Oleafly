// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createTerminalFocusTracker, type TerminalFocusTracker } from "./terminal-focus";

let tracker: TerminalFocusTracker | null = null;

function setup() {
  document.body.innerHTML = "";
  const editor = document.createElement("div");
  editor.tabIndex = 0;
  const dock = document.createElement("div");
  const textarea = document.createElement("textarea");
  dock.append(textarea);
  document.body.append(editor, dock);
  tracker = createTerminalFocusTracker(() => dock);
  return { editor, dock, textarea, tracker };
}

describe("terminal focus tracker", () => {
  afterEach(() => {
    tracker?.dispose();
    tracker = null;
  });

  it("moves focus back to the editor when the dock hides", () => {
    const { editor, textarea, tracker } = setup();
    editor.focus();
    textarea.focus();
    // Hiding the dock makes the textarea unfocusable; focus falls to the body.
    textarea.blur();
    expect(document.activeElement).toBe(document.body);
    expect(tracker.focusWasInDock()).toBe(true);

    tracker.restore();
    expect(document.activeElement).toBe(editor);
    expect(tracker.focusWasInDock()).toBe(false);
  });

  it("blurs the terminal when the editor is gone", () => {
    const { editor, textarea, tracker } = setup();
    editor.focus();
    textarea.focus();
    editor.remove();

    expect(tracker.focusWasInDock()).toBe(true);
    tracker.restore();
    expect(document.activeElement).toBe(document.body);
  });

  it("does not claim focus that never entered the dock", () => {
    const { editor, tracker } = setup();
    editor.focus();
    expect(tracker.focusWasInDock()).toBe(false);
  });

  it("stops listening once disposed", () => {
    const { editor, textarea, tracker } = setup();
    tracker.dispose();
    editor.focus();
    textarea.focus();
    textarea.blur();
    expect(tracker.focusWasInDock()).toBe(false);
  });
});
