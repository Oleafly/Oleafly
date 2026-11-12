// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { useShortcutStore } from "@/store/shortcuts";
import type { NoteDocument as NoteDocumentComponent } from "./NoteDocument";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

vi.mock("@/lib/use-fullscreen", () => ({ useFullscreen: () => false }));

vi.mock("./NoteDocument", () => ({
  NoteDocument: function NoteDocumentStandIn({ note }: Parameters<typeof NoteDocumentComponent>[0]) {
    return <div data-testid={`document-${note.id}`} />;
  },
}));

vi.mock("./NotesHome", () => ({
  NotesHome: function NotesHomeStandIn() {
    return <section data-testid="home" />;
  },
}));

import { NotesDataProvider } from "./notes-data";
import { NOTES_LAYOUT_KEY } from "./notes-layout";
import { NotesWorkspace } from "./NotesWorkspace";
import type { NoteItem } from "./types";
import { useVaultStore } from "./vault-store";

const copy = enNotes.workspace;
const originalPlatform = navigator.platform;
const notes: NoteItem[] = [{ id: "n1", title: "Masking ablation", project: "Notes", updatedAt: 0, author: "you", summary: "" }];

function searchBox(): HTMLElement {
  return within(screen.getByRole("complementary")).getByRole("combobox");
}

function hiddenSearchBox(): HTMLElement | null {
  return within(screen.getByRole("complementary")).queryByRole("combobox");
}

function pressSearch() {
  fireEvent.keyDown(window, { key: "A", code: "KeyA", ctrlKey: true, shiftKey: true });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  localStorage.removeItem(NOTES_LAYOUT_KEY);
  Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
  useShortcutStore.getState().resetAll();
});

afterEach(() => {
  Object.defineProperty(navigator, "platform", { value: originalPlatform, configurable: true });
  act(() => useVaultStore.setState({ searchRequest: 0 }));
});

describe("NotesWorkspace search shortcut", () => {
  it("shows a hidden sidebar and focuses its search box", async () => {
    const user = userEvent.setup();
    render(
      <NotesDataProvider value={fakeNotesData({ notes })}>
        <NotesWorkspace initialNoteId="n1" />
      </NotesDataProvider>,
    );
    await user.click(screen.getByRole("button", { name: copy.hideSidebar }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    act(pressSearch);
    expect(searchBox()).toHaveFocus();
  });

  it("does not open or take focus again when the sidebar comes back later", async () => {
    const user = userEvent.setup();
    render(
      <NotesDataProvider value={fakeNotesData({ notes })}>
        <NotesWorkspace initialNoteId="n1" />
      </NotesDataProvider>,
    );
    act(pressSearch);
    expect(searchBox()).toHaveFocus();
    await user.click(screen.getByRole("button", { name: copy.hideSidebar }));
    const show = screen.getByRole("button", { name: copy.showSidebar });
    await user.click(show);
    expect(hiddenSearchBox()).not.toBeInTheDocument();
    expect(show).toHaveFocus();
  });
});
