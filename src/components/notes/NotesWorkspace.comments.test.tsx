// @vitest-environment jsdom

import { groupsOf, type WorkspaceLayout } from "@oleafly/workspace";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { NotesLibrary as NotesLibraryComponent } from "./NotesLibrary";
import type { NoteItem } from "./types";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

const label = vi.hoisted(() => ({ open1: "Open n1", open2: "Open n2", library: "Library", panel: "Comments stand-in" }));

vi.mock("./NoteDocument", () => ({
  NoteDocument: ({ note }: { note: NoteItem }) => <div data-testid={`document-${note.id}`} />,
}));

vi.mock("./NotesHome", () => ({ NotesHome: () => <section data-testid="home" /> }));

vi.mock("@/components/collab/CollabSlots", () => ({
  CommentsPanel: () => <p>{label.panel}</p>,
}));

vi.mock("./NotesLibrary", () => ({
  NotesLibrary: function LibraryStandIn({ onOpenNote }: Parameters<typeof NotesLibraryComponent>[0]) {
    return (
      <aside aria-label={label.library}>
        <button type="button" onClick={() => onOpenNote("n1")}>
          {label.open1}
        </button>
        <button type="button" onClick={() => onOpenNote("n2")}>
          {label.open2}
        </button>
      </aside>
    );
  },
}));

import { useCommentsRail } from "@/components/collab/comments-rail";
import { requestNoteComments, useCollabLiveNote } from "@/lib/collab-live-bridge";
import { NotesDataProvider } from "./notes-data";
import { COMMENTS_VIEW, NOTES_LAYOUT_KEY } from "./notes-layout";
import { NotesWorkspace } from "./NotesWorkspace";

const notes: NoteItem[] = [
  { id: "n1", title: "Note n1", project: "Vision", updatedAt: 1, author: "you", summary: "", shared: true },
  { id: "n2", title: "Note n2", project: "Vision", updatedAt: 1, author: "you", summary: "" },
];
const title = enNotes.document.comments;

function renderWorkspace() {
  return render(
    <NotesDataProvider value={fakeNotesData({ notes })}>
      <NotesWorkspace />
    </NotesDataProvider>,
  );
}

function savedGroups(): string[][] {
  window.dispatchEvent(new Event("pagehide"));
  const layout = JSON.parse(localStorage.getItem(NOTES_LAYOUT_KEY) ?? "null") as WorkspaceLayout | null;
  return layout ? groupsOf(layout.root).map((candidate) => candidate.views) : [];
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  useCollabLiveNote.setState({ noteId: null });
  useCommentsRail.setState({ visible: false, canCompose: false });
});

describe("NotesWorkspace comments", () => {
  it("offers the Comments panel only on the shared note that is live with comments on, and opens and closes it", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: label.open2 }));
    act(() => useCommentsRail.setState({ visible: true }));
    expect(useCollabLiveNote.getState().noteId).toBeNull();
    expect(screen.queryByRole("button", { name: title })).toBeNull();
    act(() => useCommentsRail.setState({ visible: false }));
    await user.click(screen.getByRole("button", { name: label.open1 }));
    expect(useCollabLiveNote.getState().noteId).toBe("n1");
    expect(screen.queryByRole("button", { name: title })).toBeNull();
    act(() => useCommentsRail.setState({ visible: true }));
    const toggle = screen.getByRole("button", { name: title });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: title })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("tab", { name: title })).toBeInTheDocument();
    expect(await screen.findByText(label.panel)).toBeInTheDocument();
    expect(savedGroups().at(-1)).toEqual([COMMENTS_VIEW]);
    await user.click(screen.getByRole("button", { name: title }));
    expect(screen.queryByRole("tab", { name: title })).not.toBeInTheDocument();
  });

  it("opens the Comments panel when a comment is started or a thread is opened in the note, and keeps it open", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: label.open1 }));
    act(() => useCommentsRail.setState({ visible: true }));
    act(() => requestNoteComments());
    expect(screen.getByRole("tab", { name: title })).toBeInTheDocument();
    act(() => requestNoteComments());
    expect(screen.getByRole("tab", { name: title })).toBeInTheDocument();
    expect(savedGroups()).toEqual([["home", "note:n1"], [COMMENTS_VIEW]]);
  });
});
