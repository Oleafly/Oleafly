// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  goToDefinition: vi.fn((_view: unknown, _source?: string) => true),
  findReferences: vi.fn((_view: unknown) => true),
  startRename: vi.fn((_view: unknown) => true),
}));

vi.mock("@/lib/index/nav", () => nav);

import { codeIntel } from "./code-intel";

let view: EditorView;

function press(key: string, init: KeyboardEventInit = {}) {
  return runScopeHandlers(view, new KeyboardEvent("keydown", { key, ...init }), "editor");
}

function click(init: MouseEventInit, pos: number | null) {
  vi.spyOn(view, "posAtCoords").mockReturnValue(pos as number);
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 1, button: 0, ...init });
  view.contentDOM.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  view = new EditorView({
    state: EditorState.create({ doc: "\\ref{fig:a} text", extensions: codeIntel() }),
    parent: document.body,
  });
});

afterEach(() => {
  view.destroy();
  vi.restoreAllMocks();
});

describe("code navigation keys", () => {
  it("binds F12, Shift-F12 and F2 to definition, references and rename", () => {
    expect(press("F12")).toBe(true);
    expect(nav.goToDefinition).toHaveBeenCalledWith(view);
    expect(press("F12", { shiftKey: true })).toBe(true);
    expect(nav.findReferences).toHaveBeenCalledWith(view);
    expect(press("F2")).toBe(true);
    expect(nav.startRename).toHaveBeenCalledWith(view);
  });
});

describe("modifier click", () => {
  it("moves the cursor to the click and jumps to the definition", () => {
    const event = click({ ctrlKey: true }, 6);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.selection.main.head).toBe(6);
    expect(nav.goToDefinition).toHaveBeenCalledWith(view, "pointer");

    click({ metaKey: true }, 2);
    expect(nav.goToDefinition).toHaveBeenCalledTimes(2);
  });

  it("ignores plain clicks and clicks outside the text", () => {
    click({}, 6);
    click({ ctrlKey: true }, null);
    expect(nav.goToDefinition).not.toHaveBeenCalled();
  });
});
