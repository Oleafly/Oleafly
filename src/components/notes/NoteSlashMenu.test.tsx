// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { withBlockViews } from "./block-views";
import { noteBaseExtensions } from "./note-markdown";
import { NoteSlash, slashState } from "./note-slash";
import { NoteSlashMenu } from "./NoteSlashMenu";

const editors: Editor[] = [];

function build(): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [...noteBaseExtensions().map(withBlockViews), NoteSlash],
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  editors.push(editor);
  return editor;
}

function typeText(editor: Editor, text: string) {
  act(() => {
    editor.commands.focus();
    editor.view.dispatch(editor.state.tr.insertText(text, editor.state.selection.from));
  });
}

beforeAll(async () => {
  await loadNamespace("notes");
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

describe("NoteSlashMenu", () => {
  it("lists grouped items under the slash and inserts the clicked one", () => {
    const editor = build();
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ left: 40, right: 40, top: 100, bottom: 120 });
    render(<NoteSlashMenu editor={editor} />);
    expect(screen.queryByRole("listbox")).toBeNull();
    typeText(editor, "/");
    const menu = screen.getByRole("listbox", { name: enNotes.blocks.slash.menu });
    expect(menu.style.top).toBe("124px");
    expect(screen.getByText(enNotes.blocks.slash.basic)).toBeInTheDocument();
    expect(screen.getByText(enNotes.blocks.insert.science)).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.mouseEnter(options[2]);
    expect(slashState(editor.state).index).toBe(2);
    fireEvent.mouseEnter(screen.getAllByRole("option")[2]);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    fireEvent.mouseDown(menu);
    fireEvent.click(screen.getAllByRole("option")[0]);
    expect(editor.getJSON().content?.[0].type).toBe("heading");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says when nothing matches and opens above the line near the bottom", () => {
    const editor = build();
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ left: 5000, right: 5000, top: window.innerHeight - 10, bottom: window.innerHeight });
    render(<NoteSlashMenu editor={editor} />);
    typeText(editor, "/zzzz");
    expect(screen.getByText(enNotes.blocks.slash.noMatches)).toBeInTheDocument();
    const menu = screen.getByRole("listbox");
    expect(menu.style.bottom).toBe("14px");
    expect(Number.parseFloat(menu.style.left)).toBeLessThan(window.innerWidth);
  });

  it("falls back to the corner when the position is unknown and follows scroll and blur", () => {
    const editor = build();
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation(() => {
      throw new Error("no layout");
    });
    render(<NoteSlashMenu editor={editor} />);
    typeText(editor, "/");
    const menu = screen.getByRole("listbox");
    expect(menu.style.top).toBe("8px");
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
    });
    act(() => {
      editor.emit("blur", { editor, event: new FocusEvent("blur"), transaction: editor.state.tr });
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    act(() => {
      editor.emit("focus", { editor, event: new FocusEvent("focus"), transaction: editor.state.tr });
    });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});
