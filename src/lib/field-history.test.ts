// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { historyCommand, installPlainFieldHistory } from "./field-history";

const chord = (init: KeyboardEventInit) =>
  new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });

describe("plain field undo and redo", () => {
  let uninstall = () => {};
  let execCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    uninstall = installPlainFieldHistory();
    execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
  });

  afterEach(() => {
    uninstall();
    document.body.innerHTML = "";
  });

  it("reads Cmd or Ctrl with Z, Shift+Z and Y as undo and redo", () => {
    expect(historyCommand(chord({ key: "z", metaKey: true }))).toBe("undo");
    expect(historyCommand(chord({ key: "Z", metaKey: true, shiftKey: true }))).toBe("redo");
    expect(historyCommand(chord({ key: "y", ctrlKey: true }))).toBe("redo");
    expect(historyCommand(chord({ key: "z", metaKey: true, altKey: true }))).toBeNull();
    expect(historyCommand(chord({ key: "z" }))).toBeNull();
  });

  it("undoes and redoes in a text field when nothing else handled the keys", () => {
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();

    field.dispatchEvent(chord({ key: "z", metaKey: true }));
    field.dispatchEvent(chord({ key: "z", metaKey: true, shiftKey: true }));

    expect(execCommand.mock.calls).toEqual([["undo"], ["redo"]]);
  });

  it("leaves the document editors and keys that were already handled alone", () => {
    const editor = document.createElement("div");
    editor.className = "cm-content";
    editor.contentEditable = "true";
    editor.tabIndex = 0;
    const field = document.createElement("textarea");
    document.body.append(editor, field);

    editor.focus();
    editor.dispatchEvent(chord({ key: "z", metaKey: true }));
    field.focus();
    const handled = chord({ key: "z", metaKey: true });
    handled.preventDefault();
    field.dispatchEvent(handled);

    expect(execCommand).not.toHaveBeenCalled();
  });
});
