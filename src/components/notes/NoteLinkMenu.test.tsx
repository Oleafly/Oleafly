// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { createWysiwygExtensions, parseMarkdownBody, serializeMarkdownBody } from "@oleafly/wysiwyg";
import { TextSelection } from "@tiptap/pm/state";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { NoteLinkMenu, sameSuggestion, useEditorSuggestion } from "./NoteLinkMenu";
import { noteLinkExtensions, noteLinkSuggestion, type LinkableNote, type LinkableProject } from "./note-links";

const NOTES: LinkableNote[] = [
  { noteId: "n-1", projectId: "lib-1", title: "Masking report", color: "rose", icon: "🧪" },
  { noteId: "n-2", projectId: "lib-2", title: "" },
];
const PROJECTS: LinkableProject[] = [{ projectId: "ssl", title: "SSL masking", color: "#ff0000" }];

let editors: Editor[] = [];

function build(rect: () => { left: number; top: number; bottom: number } = () => ({ left: 40, top: 100, bottom: 120 })) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      ...createWysiwygExtensions(),
      ...noteLinkExtensions({ getNotes: () => NOTES, getProjects: () => PROJECTS, onOpenNote: vi.fn(), onOpenProject: vi.fn() }),
    ],
    content: parseMarkdownBody("A\n").doc,
  });
  editors.push(editor);
  vi.spyOn(editor.view, "coordsAtPos").mockImplementation(() => ({ ...rect(), right: 0 }));
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
  return editor;
}

function type(editor: Editor, text: string) {
  act(() => {
    for (const char of text) {
      const { from, to } = editor.state.selection;
      editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    }
  });
}

function menu(): HTMLElement {
  return screen.getByRole("listbox", { name: enNotes.links.menu });
}

beforeAll(async () => {
  await loadNamespace("notes");
});

afterEach(() => {
  for (const editor of editors) {
    editor.view.dom.parentElement?.remove();
    editor.destroy();
  }
  editors = [];
});

describe("NoteLinkMenu", () => {
  it("shows notes and projects under headings and inserts the clicked one", () => {
    const editor = build();
    render(<NoteLinkMenu editor={editor} />);
    expect(screen.queryByRole("listbox")).toBeNull();
    type(editor, "[[");
    const list = menu();
    expect(list.style.top).toBe("124px");
    expect(list.style.left).toBe("40px");
    expect(screen.getByText(enNotes.links.notes)).toBeTruthy();
    expect(screen.getByText(enNotes.links.projects)).toBeTruthy();
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["🧪Masking report", "n-2", "SSL masking"]);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(list.querySelector('[data-note-color="rose"]')).not.toBeNull();
    expect(list.querySelector('[data-project-color="#ff0000"]')).not.toBeNull();

    fireEvent.mouseEnter(options[2]);
    expect(screen.getAllByRole("option")[2].getAttribute("aria-selected")).toBe("true");
    fireEvent.mouseEnter(screen.getAllByRole("option")[2]);
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    list.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    act(() => fireEvent.click(screen.getAllByRole("option")[2]));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(serializeMarkdownBody(editor.getJSON())).toBe("A[SSL masking](oleafly://project/ssl) ");
  });

  it("keeps the active option in view while moving with the keyboard", () => {
    const editor = build();
    render(<NoteLinkMenu editor={editor} />);
    type(editor, "[[");
    const scroll = vi.fn();
    const second = screen.getAllByRole("option")[1];
    second.scrollIntoView = scroll;
    act(() => {
      editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    });
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("says when nothing matches and leaves out empty headings", () => {
    const editor = build();
    render(<NoteLinkMenu editor={editor} />);
    type(editor, "[[ssl");
    expect(screen.queryByText(enNotes.links.notes)).toBeNull();
    expect(screen.getByText(enNotes.links.projects)).toBeTruthy();
    type(editor, "zzz");
    expect(screen.getByText(enNotes.links.noMatches)).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("hides while the editor is blurred and opens above the line near the bottom", () => {
    let rect = { left: 4000, top: 700, bottom: 720 };
    const editor = build(() => rect);
    render(<NoteLinkMenu editor={editor} />);
    type(editor, "[[");
    const list = menu();
    expect(list.style.bottom).toBe(`${window.innerHeight - 700 + 4}px`);
    expect(list.style.left).toBe(`${window.innerWidth - 288 - 8}px`);

    act(() => {
      editor.emit("blur", { editor, event: new FocusEvent("blur"), transaction: editor.state.tr });
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    act(() => {
      editor.emit("focus", { editor, event: new FocusEvent("focus"), transaction: editor.state.tr });
    });
    expect(menu()).toBeTruthy();

    rect = { left: 10, top: 20, bottom: 40 };
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(menu().style.top).toBe("44px");
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(menu().style.top).toBe("44px");
  });

  it("falls back to the corner when the caret has no position and stops listening on unmount", () => {
    const editor = build(() => {
      throw new Error("no layout");
    });
    const { unmount } = render(<NoteLinkMenu editor={editor} />);
    type(editor, "[[");
    expect(menu().style.top).toBe("8px");
    unmount();
    type(editor, "m");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("useEditorSuggestion", () => {
  it("keeps the same suggestion while nothing changes and listens to scrolling only while open", () => {
    const editor = build();
    const listen = vi.spyOn(window, "addEventListener");
    const renders = vi.fn();
    const { result } = renderHook(() => {
      renders();
      return useEditorSuggestion(editor, noteLinkSuggestion);
    });
    expect(result.current).toBeNull();
    expect(listen.mock.calls.some(([name]) => name === "scroll")).toBe(false);
    const quiet = renders.mock.calls.length;
    act(() => editor.view.dispatch(editor.state.tr.setMeta("other", true)));
    expect(renders.mock.calls.length).toBe(quiet);
    type(editor, "[[");
    const shown = result.current;
    expect(shown?.items.length).toBeGreaterThan(0);
    expect(listen.mock.calls.some(([name]) => name === "scroll")).toBe(true);
    const open = renders.mock.calls.length;
    act(() => editor.view.dispatch(editor.state.tr.setMeta("other", true)));
    expect(result.current).toBe(shown);
    expect(renders.mock.calls.length).toBe(open);
    listen.mockRestore();
  });

  it("compares suggestions by value", () => {
    expect(sameSuggestion({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameSuggestion({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(sameSuggestion({ a: 1 }, { b: 1 })).toBe(false);
    expect(sameSuggestion([1], { 0: 1 })).toBe(false);
    expect(sameSuggestion(null, null)).toBe(true);
    expect(sameSuggestion(null, {})).toBe(false);
  });
});
