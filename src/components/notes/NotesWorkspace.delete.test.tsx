// @vitest-environment jsdom

import { createLayout, group, groupsOf, split, type WorkspaceLayout } from "@oleafly/workspace";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { NotesLibrary as NotesLibraryComponent } from "./NotesLibrary";
import type { NoteItem } from "./types";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

const label = vi.hoisted(() => ({ library: "Library" }));

vi.mock("./NoteDocument", () => ({
  NoteDocument: function NoteDocumentStandIn({ note }: { note: NoteItem }) {
    return <div data-testid={`document-${note.id}`} />;
  },
}));

vi.mock("./NotesHome", () => ({
  NotesHome: function HomeStandIn() {
    return <section data-testid="home" />;
  },
}));

vi.mock("./NotesLibrary", async () => {
  const { useNotesData } = await import("./notes-data");
  return {
    NotesLibrary: function LibraryStandIn({ activeNoteId }: Parameters<typeof NotesLibraryComponent>[0]) {
      const { notes, deleteNote } = useNotesData();
      return (
        <aside aria-label={label.library}>
          <output data-testid="library-active">{activeNoteId ?? "none"}</output>
          {notes.map((note) => (
            <button key={note.id} type="button" onClick={() => void deleteNote?.(note.id).catch(() => undefined)}>
              {`Delete ${note.id}`}
            </button>
          ))}
        </aside>
      );
    },
  };
});

import { NotesDataProvider, type NotesData } from "./notes-data";
import { NOTES_LAYOUT_KEY, noteView } from "./notes-layout";
import { NotesWorkspace } from "./NotesWorkspace";

const copy = enNotes.workspace;
const menu = enNotes.library.menu;

const NOTES: NoteItem[] = [
  { id: "n1", title: "Masking ablation", project: "Vision", updatedAt: 3, author: "you", summary: "" },
  { id: "n2", title: "Reading list", project: "Vision", updatedAt: 2, author: "you", summary: "" },
  { id: "n3", title: "Loose ends", project: "Vision", updatedAt: 1, author: "you", summary: "" },
];

const VIEWS = {
  home: { type: "home" },
  "note:n1": noteView("n1"),
  "note:n2": noteView("n2"),
  "note:n3": noteView("n3"),
};

function seedLayout(layout: WorkspaceLayout) {
  localStorage.setItem(NOTES_LAYOUT_KEY, JSON.stringify(layout));
}

function savedGroups(): string[][] {
  window.dispatchEvent(new Event("pagehide"));
  const layout = JSON.parse(localStorage.getItem(NOTES_LAYOUT_KEY) ?? "null") as WorkspaceLayout;
  return groupsOf(layout.root).map((candidate) => candidate.views);
}

function renderWorkspace(overrides: Partial<NotesData> = {}) {
  const deleteNote = vi.fn((_id: string) => Promise.resolve());
  const data = fakeNotesData({ notes: NOTES, deleteNote, ...overrides });
  const tree = (next: NotesData) => (
    <NotesDataProvider value={next}>
      <NotesWorkspace />
    </NotesDataProvider>
  );
  const view = render(tree(data));
  return { ...view, deleteNote: data.deleteNote, rerenderWith: (next: Partial<NotesData>) => view.rerender(tree({ ...data, ...next })) };
}

function tabNames(): string[] {
  return screen.queryAllByRole("tab").map((element) => element.querySelector(":scope > span:not([aria-hidden])")?.textContent ?? "");
}

function selectedTabs(): string[] {
  return screen
    .queryAllByRole("tab")
    .filter((element) => element.getAttribute("aria-selected") === "true")
    .map((element) => element.querySelector(":scope > span:not([aria-hidden])")?.textContent ?? "");
}

function without(id: string): readonly NoteItem[] {
  return NOTES.filter((note) => note.id !== id);
}

async function deleteFromLibrary(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(within(screen.getByRole("complementary", { name: label.library })).getByRole("button", { name: `Delete ${id}` }));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NotesWorkspace notes deleted in the app", () => {
  it("closes the open note's tab when it is deleted from its header and shows the tab beside it", async () => {
    const user = userEvent.setup();
    seedLayout(
      createLayout(
        split("s1", "row", [group("g1", ["note:n3"]), group("g2", ["note:n1", "note:n2"], "note:n1")]),
        { "note:n1": VIEWS["note:n1"], "note:n2": VIEWS["note:n2"], "note:n3": VIEWS["note:n3"] },
        "g2",
      ),
    );
    const { deleteNote } = renderWorkspace();
    const header = screen.getByRole("tabpanel", { name: "Masking ablation" }).querySelector("[data-note-view]")?.firstElementChild as HTMLElement;
    fireEvent.pointerDown(within(header).getByRole("button", { name: menu.more }), { button: 0, ctrlKey: false });
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: menu.delete }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: menu.deleteConfirm }));
    expect(deleteNote).toHaveBeenCalledExactlyOnceWith("n1");
    expect(tabNames()).toEqual(["Loose ends", "Reading list"]);
    expect(selectedTabs()).toEqual(["Loose ends", "Reading list"]);
    expect(screen.getByTestId("library-active")).toHaveTextContent("n2");
    expect(screen.queryByText(copy.missing)).not.toBeInTheDocument();
    expect(savedGroups()).toEqual([["note:n3"], ["note:n2"]]);
  });

  it("closes a background tab and leaves the active one alone", async () => {
    const user = userEvent.setup();
    seedLayout(createLayout(group("g1", ["home", "note:n1", "note:n2"], "note:n1"), { home: VIEWS.home, "note:n1": VIEWS["note:n1"], "note:n2": VIEWS["note:n2"] }));
    renderWorkspace();
    await deleteFromLibrary(user, "n2");
    expect(tabNames()).toEqual([copy.home, "Masking ablation"]);
    expect(selectedTabs()).toEqual(["Masking ablation"]);
    expect(screen.getByTestId("document-n1")).toBeInTheDocument();
  });

  it("closes the note in the other panel it is open in", async () => {
    const user = userEvent.setup();
    seedLayout(
      createLayout(
        split("s1", "row", [group("g1", ["home", "note:n1"], "note:n1"), group("g2", ["note:n2", "note:n3"], "note:n2")]),
        { home: VIEWS.home, "note:n1": VIEWS["note:n1"], "note:n2": VIEWS["note:n2"], "note:n3": VIEWS["note:n3"] },
        "g1",
      ),
    );
    renderWorkspace();
    await deleteFromLibrary(user, "n2");
    expect(savedGroups()).toEqual([["home", "note:n1"], ["note:n3"]]);
    expect(selectedTabs()).toEqual(["Masking ablation", "Loose ends"]);
  });

  it("shows the empty panel when the stage panel loses its last tab", async () => {
    const user = userEvent.setup();
    seedLayout(
      createLayout(
        split("s1", "row", [group("g1", ["home"]), group("g2", ["note:n2"])]),
        { home: VIEWS.home, "note:n2": VIEWS["note:n2"] },
        "g2",
      ),
    );
    renderWorkspace();
    await deleteFromLibrary(user, "n2");
    expect(document.querySelector("[data-empty-panel]")?.closest("[data-group]")).toHaveAttribute("data-group", "g2");
    expect(savedGroups()).toEqual([["home"], []]);
  });

  it("closes a side panel that loses its last tab, as closing the tab by hand does", async () => {
    const user = userEvent.setup();
    seedLayout(
      createLayout(
        split("s1", "row", [group("g1", ["home", "note:n1"], "note:n1"), group("g2", ["note:n2"])]),
        { home: VIEWS.home, "note:n1": VIEWS["note:n1"], "note:n2": VIEWS["note:n2"] },
        "g1",
      ),
    );
    renderWorkspace();
    await deleteFromLibrary(user, "n2");
    expect(savedGroups()).toEqual([["home", "note:n1"]]);
    expect(document.querySelector("[data-empty-panel]")).toBeNull();
  });

  it("keeps the tab when the deletion fails", async () => {
    const user = userEvent.setup();
    seedLayout(createLayout(group("g1", ["home", "note:n1"], "note:n1"), { home: VIEWS.home, "note:n1": VIEWS["note:n1"] }));
    renderWorkspace({ deleteNote: vi.fn(() => Promise.reject(new Error("The disk is read only."))) });
    await deleteFromLibrary(user, "n1");
    expect(tabNames()).toEqual([copy.home, "Masking ablation"]);
    expect(screen.getByTestId("document-n1")).toBeInTheDocument();
  });

  it("skips the deleted note in Back and Forward", async () => {
    const user = userEvent.setup();
    const history = { entries: [{ view: "home" }, { view: "note:n2" }, { view: "note:n1" }], index: 2 };
    seedLayout(
      createLayout(group("g1", ["note:n1", "note:n2"], "note:n1"), {
        "note:n1": { type: "note", params: { noteId: "n1", history } },
        "note:n2": VIEWS["note:n2"],
      }),
    );
    const { rerenderWith } = renderWorkspace();
    await deleteFromLibrary(user, "n2");
    rerenderWith({ notes: without("n2") });
    expect(tabNames()).toEqual(["Masking ablation"]);
    await user.click(screen.getByRole("button", { name: copy.back }));
    expect(tabNames()).toEqual([copy.home]);
  });
});

describe("NotesWorkspace notes removed outside the app", () => {
  it("keeps the tab and says the note is no longer in the library", () => {
    seedLayout(createLayout(group("g1", ["home", "note:n1"], "note:n1"), { home: VIEWS.home, "note:n1": VIEWS["note:n1"] }));
    const { rerenderWith, deleteNote } = renderWorkspace();
    rerenderWith({ notes: without("n1") });
    expect(tabNames()).toEqual([copy.home, enNotes.document.untitled]);
    const missing = screen.getByRole("tabpanel", { name: enNotes.document.untitled });
    expect(within(missing).getByText(copy.missing)).toBeInTheDocument();
    expect(within(missing).getByRole("button", { name: copy.closeMissing })).toBeInTheDocument();
    expect(deleteNote).not.toHaveBeenCalled();
  });
});
