// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { NoteLinkRecord } from "@/lib/tauri";
import { NoteDeadLinks, NoteDeadLinksSection } from "./NoteDeadLinks";
import { NotePanelSections } from "./NoteListItem";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { NoteLinkIndexProvider } from "./use-note-links";
import type { NoteItem } from "./types";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

const copy = enNotes.linksSearch.dead;

const NOTES: NoteItem[] = [
  { id: "lib-1", noteId: "n-1", title: "Masking report", project: "SSL", updatedAt: 0, author: "you", summary: "" },
  { id: "lib-2", noteId: "n-2", title: "Abstract draft", project: "SSL", updatedAt: 0, author: "you", summary: "" },
];

const RECORDS: NoteLinkRecord[] = [
  {
    projectId: "lib-1",
    noteId: "n-1",
    title: "Masking report",
    links: [
      { kind: "note", id: "gone", snippet: "See the old plan.", line: 6 },
      { kind: "note", id: "n-2", snippet: "Results here", block: "zzz", line: 9 },
    ],
    blocks: [],
  },
  { projectId: "lib-2", noteId: "n-2", title: "Abstract draft", links: [], blocks: ["acc"] },
];

const TEXTS: Record<string, string> = {
  "lib-1": "---\nid: n-1\n---\nSee the [old plan](oleafly://note/gone).\n\n[Results here](oleafly://note/n-2#^zzz)\n",
  "lib-2": "---\nid: n-2\n---\nAccuracy ^acc\n",
  "lib-3": "---\nid: n-3\n---\n",
};

function renderDeadLinks(records: NoteLinkRecord[] = RECORDS, extra: Partial<NotesData> = {}) {
  const onOpenNoteAt = vi.fn();
  const saveNote = vi.fn(async (id: string, text: string) => ({ text, version: `${id}-v2` }));
  const value: NotesData = fakeNotesData({
    notes: NOTES,
    noteLinks: () => Promise.resolve(records),
    loadNote: async (id: string) => ({ text: TEXTS[id] ?? "", version: `${id}-v1` }),
    saveNote,
    ...extra,
  });
  render(
    <NotesDataProvider value={value}>
      <NoteLinkIndexProvider>
        <NoteDeadLinks onOpenNoteAt={onOpenNoteAt} />
      </NoteLinkIndexProvider>
    </NotesDataProvider>,
  );
  return { onOpenNoteAt, saveNote };
}

describe("NoteDeadLinks", () => {
  it("groups links to missing notes and missing blocks and opens the source at the link", async () => {
    const { onOpenNoteAt } = renderDeadLinks();
    await screen.findByText(copy.summary_other.replace("{{count}}", "2"));
    const notes = screen.getByRole("region", { name: `${copy.missingNotes} (1)` });
    expect(within(notes).getByText("Line 6: the note no longer exists")).toBeTruthy();
    const blocks = screen.getByRole("region", { name: `${copy.missingBlocks} (1)` });
    expect(within(blocks).getByText("Line 9: ^zzz is no longer in Abstract draft")).toBeTruthy();
    fireEvent.click(within(notes).getByText("See the old plan."));
    expect(onOpenNoteAt).toHaveBeenLastCalledWith("lib-1", "~See the old plan.");
  });

  it("removes a link, points a block link at its note and creates a missing note", async () => {
    const createNoteFrom = vi.fn(async () => "lib-3");
    const { saveNote } = renderDeadLinks(RECORDS, { createNoteFrom });
    await screen.findByText(copy.summary_other.replace("{{count}}", "2"));
    fireEvent.click(screen.getByRole("button", { name: copy.relink.replace("{{title}}", "Abstract draft") }));
    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1));
    expect(saveNote.mock.calls[0][1]).toContain("[Results here](oleafly://note/n-2)\n");
    await waitFor(() => expect(screen.queryByRole("region", { name: `${copy.missingBlocks} (1)` })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: copy.create }));
    await waitFor(() => expect(createNoteFrom).toHaveBeenCalledWith({ title: "old plan" }));
    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(2));
    expect(saveNote.mock.calls[1][1]).toContain("See the [old plan](oleafly://note/n-3).");
    expect(await screen.findByText(copy.none)).toBeTruthy();
  });

  it("removes a link without creating anything", async () => {
    const { saveNote } = renderDeadLinks([RECORDS[0], RECORDS[1]]);
    await screen.findByText(copy.summary_other.replace("{{count}}", "2"));
    fireEvent.click(within(screen.getByRole("region", { name: `${copy.missingNotes} (1)` })).getByRole("button", { name: copy.remove }));
    await waitFor(() => expect(saveNote).toHaveBeenCalledWith("lib-1", expect.stringContaining("See the old plan.\n"), "lib-1-v1"));
  });

  it("says when every link is fine", async () => {
    renderDeadLinks([{ ...RECORDS[0], links: [] }, RECORDS[1]]);
    expect(await screen.findByText(copy.none)).toBeTruthy();
  });
});

describe("NoteDeadLinksSection", () => {
  function renderSection(noteId: string, editable = true) {
    const onOpenNoteAt = vi.fn();
    const saveNote = vi.fn(async (id: string, text: string) => ({ text, version: `${id}-v2` }));
    render(
      <NotesDataProvider
        value={fakeNotesData({
          notes: NOTES,
          noteLinks: () => Promise.resolve(RECORDS),
          loadNote: async (id: string) => ({ text: TEXTS[id] ?? "", version: `${id}-v1` }),
          saveNote,
        })}
      >
        <NoteLinkIndexProvider>
          <NotePanelSections>
            <NoteDeadLinksSection noteId={noteId} editable={editable} onOpenNoteAt={onOpenNoteAt} />
          </NotePanelSections>
        </NoteLinkIndexProvider>
      </NotesDataProvider>,
    );
    return { onOpenNoteAt, saveNote };
  }

  it("lists only the open note's dead links, opens one at the link and fixes it from its row", async () => {
    const { onOpenNoteAt, saveNote } = renderSection("lib-1");
    const toggle = await screen.findByRole("button", { name: `${copy.title} 2` });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const section = screen.getByRole("region", { name: copy.title });
    expect(within(section).getAllByRole("listitem").map((item) => item.getAttribute("data-dead-link"))).toEqual(["note", "block"]);
    fireEvent.click(within(section).getByRole("button", { name: /Line 6: the note no longer exists/u }));
    expect(onOpenNoteAt).toHaveBeenLastCalledWith("lib-1", "~See the old plan.");
    fireEvent.click(within(section).getAllByRole("button", { name: copy.remove })[0]);
    await waitFor(() => expect(saveNote).toHaveBeenCalledWith("lib-1", expect.stringContaining("See the old plan.\n"), "lib-1-v1"));
    await waitFor(() => expect(screen.getByRole("button", { name: `${copy.title} 1` })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: `${copy.title} 1` }));
    expect(useNotesPrefsStore.getState().deadLinksOpen).toBe(false);
    useNotesPrefsStore.getState().set("deadLinksOpen", true);
  });

  it("lists a read-only note's dead links without the buttons that would change it", async () => {
    const { onOpenNoteAt } = renderSection("lib-1", false);
    const section = await screen.findByRole("region", { name: copy.title });
    await screen.findByRole("button", { name: `${copy.title} 2` });
    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
    expect(within(section).queryByRole("button", { name: copy.remove })).toBeNull();
    fireEvent.click(within(section).getByRole("button", { name: /Line 6: the note no longer exists/u }));
    expect(onOpenNoteAt).toHaveBeenLastCalledWith("lib-1", "~See the old plan.");
  });

  it("says so when the note has no dead links", async () => {
    renderSection("lib-2");
    expect(await screen.findByRole("button", { name: `${copy.title} 0` })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: copy.title })).toHaveTextContent(enNotes.info.noDeadLinks);
  });
});
