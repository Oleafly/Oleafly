// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { NoteDocument as NoteDocumentComponent } from "./NoteDocument";
import type { NotesLibrary as NotesLibraryComponent } from "./NotesLibrary";

vi.mock("@/lib/use-fullscreen", () => ({ useFullscreen: () => false }));

const label = vi.hoisted(() => ({ today: "Library today", openFirst: "Library open n1", library: "Library stand-in" }));

vi.mock("./NoteDocument", () => ({
  NoteDocument: function NoteDocumentStandIn({ note, onOpenTag }: Parameters<typeof NoteDocumentComponent>[0]) {
    return (
      <div data-testid={`document-${note.id}`}>
        <button type="button" onClick={() => onOpenTag?.("ML/Vision")}>
          {`Tag in ${note.id}`}
        </button>
      </div>
    );
  },
}));

vi.mock("./NotesLibrary", () => ({
  NotesLibrary: function NotesLibraryStandIn({ onToday, onOpenNote }: Parameters<typeof NotesLibraryComponent>[0]) {
    return (
      <aside aria-label={label.library}>
        <button type="button" disabled={!onToday} onClick={onToday}>
          {label.today}
        </button>
        <button type="button" onClick={() => onOpenNote("n1")}>
          {label.openFirst}
        </button>
      </aside>
    );
  },
}));

vi.mock("./NotesHome", () => ({
  NotesHome: function NotesHomeStandIn() {
    return <section data-testid="home" />;
  },
}));

import { localDate } from "./note-templates";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { NOTES_LAYOUT_KEY } from "./notes-layout";
import { NotesWorkspace } from "./NotesWorkspace";
import type { NoteItem } from "./types";
import { setQuickSwitcherOpen, useVaultStore } from "./vault-store";

function note(id: string, title: string): NoteItem {
  return { id, title, project: "Notes", updatedAt: 0, author: "you", summary: "" };
}

const notes = [note("n1", "Masking ablation"), note("n2", "Reading list"), note("today", localDate(new Date()))];

function data(): NotesData {
  return {
    notes,
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    loadNote: vi.fn(),
    saveNote: vi.fn(),
  };
}

function tabNames(): string[] {
  return screen.queryAllByRole("tab").map((tab) => tab.textContent ?? "");
}

beforeAll(async () => {
  await loadNamespace("notes");
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  localStorage.removeItem(NOTES_LAYOUT_KEY);
});

afterEach(() => {
  act(() => useVaultStore.setState({ tag: null, tagRequest: 0, switcherOpen: false }));
});

describe("NotesWorkspace vault wiring", () => {
  it("opens a switcher pick in place of the focused tab and Mod+Enter in a new tab", async () => {
    const user = userEvent.setup();
    render(
      <NotesDataProvider value={data()}>
        <NotesWorkspace />
      </NotesDataProvider>,
    );
    expect(screen.getByTestId("home")).toBeInTheDocument();
    act(() => setQuickSwitcherOpen(true));
    await user.type(screen.getByPlaceholderText(enNotes.vault.switcher.placeholder), "masking");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("document-n1")).toBeInTheDocument());
    expect(screen.queryByTestId("home")).not.toBeInTheDocument();
    act(() => setQuickSwitcherOpen(true));
    await user.type(screen.getByPlaceholderText(enNotes.vault.switcher.placeholder), "reading");
    fireEvent.keyDown(screen.getByPlaceholderText(enNotes.vault.switcher.placeholder), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(tabNames().some((name) => name.includes("Reading list"))).toBe(true));
    expect(tabNames().some((name) => name.includes("Masking ablation"))).toBe(true);
  });

  it("filters the sidebar by a tag clicked in a note and shows the sidebar", async () => {
    const user = userEvent.setup();
    render(
      <NotesDataProvider value={data()}>
        <NotesWorkspace initialNoteId="n2" />
      </NotesDataProvider>,
    );
    await user.click(screen.getByRole("button", { name: enNotes.workspace.hideSidebar }));
    expect(screen.queryByRole("complementary", { name: "Library stand-in" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tag in n2" }));
    expect(useVaultStore.getState().tag).toBe("ml/vision");
    expect(screen.getByRole("complementary", { name: "Library stand-in" })).toBeInTheDocument();
  });

  it("opens today's note from the sidebar", async () => {
    const user = userEvent.setup();
    render(
      <NotesDataProvider value={data()}>
        <NotesWorkspace />
      </NotesDataProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Library today" }));
    await waitFor(() => expect(screen.getByTestId("document-today")).toBeInTheDocument());
  });

  it("opens in a new tab when no tab is focused", async () => {
    const user = userEvent.setup();
    localStorage.setItem(NOTES_LAYOUT_KEY, JSON.stringify({ root: { type: "group", id: "g", views: [], active: null }, views: {} }));
    render(
      <NotesDataProvider value={data()}>
        <NotesWorkspace />
      </NotesDataProvider>,
    );
    act(() => setQuickSwitcherOpen(true));
    await user.type(screen.getByPlaceholderText(enNotes.vault.switcher.placeholder), "masking");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("document-n1")).toBeInTheDocument());
  });
});
