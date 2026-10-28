// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  historyCommand,
  inPlainField,
  inVisualForm,
  inWidgetControl,
  installPlainFieldHistory,
  visualFormHistory,
} from "./field-history";

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

  it("undoes in a field a widget draws inside the source text, not in the document", () => {
    const content = document.createElement("div");
    content.className = "cm-content";
    content.contentEditable = "true";
    const cell = document.createElement("textarea");
    const choice = document.createElement("select");
    content.append(cell, choice);
    document.body.append(content);

    cell.focus();
    cell.dispatchEvent(chord({ key: "z", ctrlKey: true }));

    expect(execCommand.mock.calls).toEqual([["undo"]]);
    expect(inPlainField(content)).toBe(false);
    expect(inPlainField(cell)).toBe(true);
    expect(inWidgetControl(cell)).toBe(true);
    expect(inWidgetControl(choice)).toBe(true);
    expect(inWidgetControl(content)).toBe(false);
  });
});

describe("Visual-mode forms", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function form(inside: HTMLElement): { field: HTMLInputElement; button: HTMLButtonElement } {
    const card = document.createElement("div");
    card.setAttribute("data-ofl-visual-form", "");
    const field = document.createElement("input");
    const button = document.createElement("button");
    card.append(field, button);
    inside.append(card);
    return { field, button };
  }

  it("routes menu history in a card to the field only while it holds a draft", () => {
    const content = document.createElement("div");
    content.className = "cm-content";
    document.body.append(content);
    const { field, button } = form(content);

    expect(inVisualForm(field)).toBe(true);
    expect(visualFormHistory(field)).toBe("document");
    field.setAttribute("data-ofl-form-draft", "");
    expect(visualFormHistory(field)).toBe("field");
    expect(visualFormHistory(button)).toBe("document");
    expect(inWidgetControl(button)).toBe(true);
  });

  it("treats a chip's popover outside the text like a card", () => {
    const { field } = form(document.body);
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);

    expect(inVisualForm(field)).toBe(true);
    expect(visualFormHistory(field)).toBe("document");
    expect(inWidgetControl(field)).toBe(true);
    expect(inVisualForm(elsewhere)).toBe(false);
    expect(visualFormHistory(elsewhere)).toBeNull();
    expect(visualFormHistory(null)).toBeNull();
  });

  it("keeps document shortcuts for the editor's own panels", () => {
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    const search = document.createElement("input");
    editor.append(search);
    document.body.append(editor);

    expect(inWidgetControl(search)).toBe(false);
    expect(inWidgetControl(null)).toBe(false);
  });
});
