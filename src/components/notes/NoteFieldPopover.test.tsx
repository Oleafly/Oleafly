// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { destroyKbEditors, kbEditor, kbMarkdown } from "./tests/kb-editor-fixtures";
import "./tests/setup";
import { NoteFieldPopover } from "./NoteFieldPopover";

afterEach(destroyKbEditors);

function open(markdown: string, index = 0) {
  const editor = kbEditor(markdown);
  render(<NoteFieldPopover editor={editor} />);
  const chip = editor.view.dom.querySelectorAll<HTMLElement>(".note-field")[index];
  act(() => {
    chip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  });
  return editor;
}

describe("editing a field chip", () => {
  it("changes a date with the calendar", () => {
    const editor = open("- [ ] Ship [due:: 2026-11-12]");
    const dialog = screen.getByRole("dialog", { name: `Edit ${enNotes.fields.keys.due}` });
    const day = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "20");
    fireEvent.click(day as HTMLButtonElement);
    expect(kbMarkdown(editor)).toBe("- [ ] Ship [due:: 2026-11-20]");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("changes a priority", () => {
    const editor = open("Ship [priority:: high]");
    expect(screen.getByRole("button", { name: enNotes.fields.priorities.high }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: enNotes.fields.priorities.low }));
    expect(kbMarkdown(editor)).toBe("Ship [priority:: low]");
  });

  it("renames and revalues a custom field", () => {
    const editor = open("Ship [status:: draft] [due:: 2026-11-12]");
    fireEvent.change(screen.getByLabelText(enNotes.fields.editor.key), { target: { value: "state" } });
    fireEvent.change(screen.getByLabelText(enNotes.fields.editor.value), { target: { value: "in review" } });
    fireEvent.click(screen.getByRole("button", { name: enNotes.fields.editor.save }));
    expect(kbMarkdown(editor)).toBe("Ship [state:: in review] [due:: 2026-11-12]");
  });

  it("refuses a value with a stray bracket and says why", () => {
    const editor = open("Ship [status:: draft] now");
    const value = screen.getByLabelText(enNotes.fields.editor.value);
    fireEvent.change(value, { target: { value: "a]b" } });
    expect(value.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(enNotes.fields.editor.brackets)).toBeTruthy();
    expect(screen.getByRole("button", { name: enNotes.fields.editor.save }).hasAttribute("disabled")).toBe(true);
    fireEvent.submit(value.closest("form") as HTMLFormElement);
    expect(kbMarkdown(editor)).toBe("Ship [status:: draft] now");
    fireEvent.change(value, { target: { value: "see [[Plan]]" } });
    fireEvent.click(screen.getByRole("button", { name: enNotes.fields.editor.save }));
    expect(kbMarkdown(editor)).toBe("Ship [status:: see [[Plan]]] now");
  });

  it("refuses an empty name and removes a field", () => {
    const editor = open("Ship [status:: draft] now");
    fireEvent.change(screen.getByLabelText(enNotes.fields.editor.key), { target: { value: " " } });
    expect(screen.getByRole("button", { name: enNotes.fields.editor.save }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: enNotes.fields.editor.remove }));
    expect(kbMarkdown(editor)).toBe("Ship now");
  });

  it("removes a field at the start or end of a line without eating text", () => {
    const first = open("[status:: draft] rest");
    fireEvent.click(screen.getByRole("button", { name: enNotes.fields.editor.remove }));
    expect(kbMarkdown(first)).toBe("rest");
  });

  it("does nothing when the field went away while the editor was open", () => {
    const editor = open("Ship [priority:: high] now");
    act(() => {
      editor.view.dispatch(editor.state.tr.delete(6, 7));
    });
    fireEvent.click(screen.getByRole("button", { name: enNotes.fields.priorities.low }));
    expect(kbMarkdown(editor)).toBe("Ship  now");
  });

  it("closes on Escape without changing the note", () => {
    const editor = open("Ship [due:: 2026-11-12]");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(kbMarkdown(editor)).toBe("Ship [due:: 2026-11-12]");
  });
});
