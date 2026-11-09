// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { NoteLinkRecord } from "@/lib/tauri";
import { NoteDocument } from "./NoteDocument";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { NoteItem, NoteSource } from "./types";

const editors = vi.hoisted(() => ({ last: null as Editor | null }));

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      editors.last = editor;
      return editor;
    },
  };
});

vi.mock("./NoteAssistant", async () => {
  const { forwardRef } = await import("react");
  return {
    NoteAssistant: forwardRef(function NoteAssistant(props: { review: ReactNode }, _ref) {
      return <section data-testid="note-assistant">{props.review}</section>;
    }),
  };
});

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  listNoteTags: () => Promise.resolve([]),
}));

const TEXT = [
  "---",
  "title: Masking",
  "kind: note",
  "id: n-1",
  "status: draft # keep",
  "---",
  "",
  "# Masking",
  "",
  "- [ ] Rerun seeds",
  "- plain item",
  "",
  "> [!warning]- Watch out",
  "> Small batches",
  "",
  "Read ==this== and [Method](oleafly://note/n-2#method) for #ssl.",
  "",
  "## Results",
  "",
  "Edit me",
  "",
].join("\n");

const NOTE: NoteItem = { id: "lib-1", title: "Masking", project: "Vision", updatedAt: 1, author: "you", summary: "" };
const OTHER: NoteItem = { id: "lib-2", title: "Method", project: "Vision", updatedAt: 1, author: "you", summary: "", preview: "Steps" };
const RECORDS: NoteLinkRecord[] = [
  { projectId: "lib-1", noteId: "n-1", title: "Masking", links: [] },
  { projectId: "lib-2", noteId: "n-2", title: "Method", links: [] },
];

function fakeData() {
  const saveNote = vi.fn(async (_id: string, text: string): Promise<NoteSource> => ({ text, version: "v2" }));
  const data: NotesData = {
    notes: [NOTE, OTHER],
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    loadNote: vi.fn(async (id: string) => ({ text: id === "lib-1" ? TEXT : "# Method\nSteps", version: "v1" })),
    saveNote,
    noteLinks: () => Promise.resolve(RECORDS),
  };
  return { data, saveNote };
}

async function open(props: Partial<Parameters<typeof NoteDocument>[0]> = {}) {
  const fake = fakeData();
  const onOpenNote = vi.fn();
  const onOpenTag = vi.fn();
  const view = render(
    <NotesDataProvider value={fake.data}>
      <NoteDocument note={NOTE} insertRequest={null} onSendToPaper={vi.fn()} onOpenNote={onOpenNote} onOpenTag={onOpenTag} {...props} />
    </NotesDataProvider>,
  );
  await screen.findByLabelText(enNotes.document.titleLabel);
  const editor = editors.last as Editor;
  return { ...view, editor, fake, onOpenNote, onOpenTag };
}

async function save() {
  await act(async () => {
    fireEvent.blur(window);
  });
}

beforeAll(async () => {
  await loadNamespace("notes");
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  editors.last = null;
});

describe("knowledge base features in a note", () => {
  it("draws tasks, callouts, highlights and tags, and saves untouched blocks byte for byte", async () => {
    const { editor, fake } = await open();
    expect(editor.view.dom.querySelectorAll("input.note-task-box")).toHaveLength(2);
    expect(editor.view.dom.querySelector(".note-callout[data-tone='orange']")).toBeTruthy();
    expect(editor.view.dom.querySelector("mark.note-highlight")?.textContent).toBe("this");
    expect(editor.view.dom.querySelector(".note-tag")?.getAttribute("data-tag")).toBe("ssl");
    act(() => {
      const end = editor.state.doc.content.size - 1;
      editor.view.dispatch(editor.state.tr.insertText("!", end));
    });
    await save();
    expect(fake.saveNote.mock.calls.at(-1)?.[1]).toBe(TEXT.replace("Edit me", "Edit me!"));
  });

  it("edits properties into the front matter and keeps its comments", async () => {
    const { fake } = await open();
    const status = screen.getByRole("textbox", { name: "Value of status" });
    fireEvent.change(status, { target: { value: "final" } });
    fireEvent.blur(status);
    await save();
    expect(fake.saveNote.mock.calls.at(-1)?.[1]).toContain("status: final # keep");
  });

  it("opens linked notes at a heading, opens tags, and scrolls when asked", async () => {
    const { editor, onOpenNote, onOpenTag, rerender, fake } = await open();
    await waitFor(() => expect(editor.view.dom.querySelector(".note-link[data-note-id='n-2']")).toBeTruthy());
    editor.view.dom.querySelector("a")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(onOpenNote).toHaveBeenCalledWith("lib-2", { newTab: false, heading: "method" });
    editor.view.dom.querySelector(".note-tag")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(onOpenTag).toHaveBeenCalledWith("ssl");
    rerender(
      <NotesDataProvider value={fake.data}>
        <NoteDocument note={NOTE} insertRequest={null} onSendToPaper={vi.fn()} onOpenNote={onOpenNote} openHeading={{ slug: "results", id: 1 }} />
      </NotesDataProvider>,
    );
    expect(editor.state.selection.$from.parent.textContent).toBe("Results");
    fireEvent.click(screen.getByRole("button", { name: enNotes.kb.properties.add }));
    expect(screen.getByRole("textbox", { name: enNotes.kb.properties.newName })).toBeTruthy();
  });

  it("opens a linked note without a heading from a property", async () => {
    localStorage.setItem("oleafly.notes.propertyTypes", JSON.stringify({ source: "link" }));
    const fake = fakeData();
    fake.data.loadNote = vi.fn(async () => ({ text: "---\nid: n-1\nsource: oleafly://note/n-2\n---\nBody", version: "v1" }));
    const onOpenNote = vi.fn();
    render(
      <NotesDataProvider value={fake.data}>
        <NoteDocument note={NOTE} insertRequest={null} onSendToPaper={vi.fn()} onOpenNote={onOpenNote} />
      </NotesDataProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open Method" }));
    expect(onOpenNote).toHaveBeenCalledWith("lib-2", { newTab: false });
    localStorage.clear();
  });
});
