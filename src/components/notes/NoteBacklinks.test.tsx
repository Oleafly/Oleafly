// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { NoteLinkRecord } from "@/lib/tauri";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { NoteBacklinks } from "./NoteBacklinks";
import { NotePanelSections } from "./NoteListItem";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { NoteLinkIndexProvider } from "./use-note-links";
import type { NoteItem } from "./types";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

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

function renderBacklinks(noteId: string | null, records: NoteLinkRecord[] = RECORDS, notes: NoteItem[] = NOTES) {
  const onOpenNote = vi.fn();
  const value: NotesData = fakeNotesData({
    notes,
    noteLinks: () => Promise.resolve(records),
  });
  const view = render(
    <NotesDataProvider value={value}>
      <NoteLinkIndexProvider>
        <NoteBacklinks noteId={noteId} onOpenNote={onOpenNote} />
      </NoteLinkIndexProvider>
    </NotesDataProvider>,
  );
  return { ...view, onOpenNote };
}

const LINKED_FROM = enNotes.links.linkedFrom;

function header(count: number): HTMLElement {
  return screen.getByRole("button", { name: `${LINKED_FROM} ${count}` });
}

afterEach(() => {
  useNotesPrefsStore.getState().set("backlinksOpen", true);
});

describe("NoteBacklinks", () => {
  it("stays in the info panel for a note nothing links to, with a zero count and a short line once the links are known", async () => {
    render(
      <NotesDataProvider value={fakeNotesData({ notes: NOTES, noteLinks: () => Promise.resolve(RECORDS) })}>
        <NoteLinkIndexProvider>
          <NotePanelSections>
            <NoteBacklinks noteId="n-2" onOpenNote={vi.fn()} />
          </NotePanelSections>
        </NoteLinkIndexProvider>
      </NotesDataProvider>,
    );
    const section = screen.getByRole("region", { name: LINKED_FROM });
    expect(screen.getByRole("button", { name: LINKED_FROM })).toHaveAttribute("aria-expanded", "true");
    expect(section).not.toHaveTextContent(enNotes.info.noBacklinks);
    await waitFor(() => expect(header(0)).toHaveAttribute("aria-expanded", "true"));
    expect(section).toHaveTextContent(enNotes.info.noBacklinks);
  });

  it("lists the notes that link here and opens one", async () => {
    const { onOpenNote, container } = renderBacklinks("n-1");
    const section = await screen.findByRole("region", { name: LINKED_FROM });
    const buttons = within(section)
      .getAllByRole("listitem")
      .map((item) => within(item).getByRole("button"));
    expect(buttons.map((button) => button.textContent)).toEqual(["🧪Abstract draftSee the report.", "Reading notes"]);
    expect(container.querySelector('[data-note-color="rose"]')).not.toBeNull();

    fireEvent.click(buttons[0]);
    expect(onOpenNote).toHaveBeenLastCalledWith("n-2", { newTab: false, projectId: "lib-2" });
    fireEvent.click(buttons[1], { metaKey: true });
    expect(onOpenNote).toHaveBeenLastCalledWith(null, { newTab: false, projectId: "lib-3" });
    fireEvent.click(buttons[1], { ctrlKey: true });
    expect(onOpenNote).toHaveBeenLastCalledWith(null, { newTab: true, projectId: "lib-3" });
  });

  it("shows the first 50 backlinks of a hub note and the rest on request", async () => {
    const many: NoteLinkRecord[] = Array.from({ length: 51 }, (_, index) => ({
      projectId: `hub-${index}`,
      noteId: `h-${index}`,
      title: `Linking note ${index}`,
      links: [{ kind: "note", id: "n-1", snippet: "" }],
    }));
    const hubNotes = many.map((record) => ({ ...NOTES[2], id: record.projectId, title: record.title }));
    renderBacklinks("n-1", [RECORDS[0], ...many], [NOTES[0], ...hubNotes]);
    const section = await screen.findByRole("region", { name: LINKED_FROM });
    const showAll = enNotes.links.showAll.replace("{{total}}", "51");
    expect(within(section).getAllByRole("listitem")).toHaveLength(50);
    fireEvent.click(header(51));
    expect(within(section).queryByRole("button", { name: showAll })).toBeNull();
    fireEvent.click(header(51));
    fireEvent.click(within(section).getByRole("button", { name: showAll }));
    expect(within(section).getAllByRole("listitem")).toHaveLength(51);
    expect(within(section).queryByRole("button", { name: showAll })).toBeNull();
  });

  it("shows nothing when no note links here", async () => {
    const { container } = renderBacklinks("n-2");
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    const missing = renderBacklinks(null);
    expect(missing.container).toBeEmptyDOMElement();
  });
});

describe("NoteBacklinks folding", () => {
  it("shows the count in the header and folds and opens from it by click, Enter or Space", async () => {
    const user = userEvent.setup();
    renderBacklinks("n-1");
    const section = await screen.findByRole("region", { name: LINKED_FROM });
    const toggle = header(2);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(list?.tagName).toBe("UL");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(list).not.toBeVisible();
    expect(within(section).queryAllByRole("listitem")).toHaveLength(0);
    expect(useNotesPrefsStore.getState().backlinksOpen).toBe(false);
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("remembers the folded choice for the next note it shows", async () => {
    const first = renderBacklinks("n-1");
    await screen.findByRole("region", { name: LINKED_FROM });
    fireEvent.click(header(2));
    first.unmount();
    const toReport: NoteLinkRecord = { ...RECORDS[0], links: [{ kind: "note", id: "n-2", snippet: "" }] };
    renderBacklinks("n-2", [toReport, ...RECORDS.slice(1)]);
    await screen.findByRole("region", { name: LINKED_FROM });
    expect(header(1)).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Masking report")).not.toBeInTheDocument();
    fireEvent.click(header(1));
    expect(screen.getByText("Masking report")).toBeInTheDocument();
  });
});
