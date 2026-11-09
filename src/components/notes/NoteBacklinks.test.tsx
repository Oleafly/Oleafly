// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { NoteLinkRecord } from "@/lib/tauri";
import { NoteBacklinks } from "./NoteBacklinks";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { NoteItem } from "./types";

const NOTES: NoteItem[] = [
  { id: "lib-1", title: "Masking report", project: "SSL", updatedAt: 0, author: "you", summary: "" },
  { id: "lib-2", title: "Abstract draft", project: "SSL", updatedAt: 0, author: "you", summary: "", color: "rose", icon: "🧪" },
  { id: "lib-3", title: "Reading notes", project: "SSL", updatedAt: 0, author: "you", summary: "" },
];

const RECORDS: NoteLinkRecord[] = [
  { projectId: "lib-1", noteId: "n-1", title: "Masking report", links: [] },
  { projectId: "lib-2", noteId: "n-2", title: "Abstract draft", links: [{ kind: "note", id: "n-1", snippet: "See the report." }] },
  { projectId: "lib-3", noteId: null, title: "Reading notes", links: [{ kind: "note", id: "n-1", snippet: "" }] },
];

function renderBacklinks(noteId: string | null, records: NoteLinkRecord[] = RECORDS) {
  const onOpenNote = vi.fn();
  const value: NotesData = {
    notes: NOTES,
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    loadNote: vi.fn(),
    saveNote: vi.fn(),
    noteLinks: () => Promise.resolve(records),
  };
  const view = render(
    <NotesDataProvider value={value}>
      <NoteBacklinks noteId={noteId} onOpenNote={onOpenNote} className="extra" />
    </NotesDataProvider>,
  );
  return { ...view, onOpenNote };
}

beforeAll(async () => {
  await loadNamespace("notes");
});

describe("NoteBacklinks", () => {
  it("lists the notes that link here and opens one", async () => {
    const { onOpenNote, container } = renderBacklinks("n-1");
    const section = await screen.findByRole("region", { name: enNotes.links.linkedFrom });
    expect(section.className).toContain("extra");
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["🧪Abstract draftSee the report.", "Reading notes"]);
    expect(container.querySelector('[data-note-color="rose"]')).not.toBeNull();

    fireEvent.click(buttons[0]);
    expect(onOpenNote).toHaveBeenLastCalledWith("n-2", { newTab: false, projectId: "lib-2" });
    fireEvent.click(buttons[1], { metaKey: true });
    expect(onOpenNote).toHaveBeenLastCalledWith(null, { newTab: false, projectId: "lib-3" });
    fireEvent.click(buttons[1], { ctrlKey: true });
    expect(onOpenNote).toHaveBeenLastCalledWith(null, { newTab: true, projectId: "lib-3" });
  });

  it("shows nothing when no note links here", async () => {
    const { container } = renderBacklinks("n-2");
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    const missing = renderBacklinks(null);
    expect(missing.container).toBeEmptyDOMElement();
  });
});
