// @vitest-environment jsdom

import { groupsOf, type WorkspaceLayout } from "@oleafly/workspace";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import type { NoteDocument as NoteDocumentComponent } from "./NoteDocument";
import type { NotesLibrary as NotesLibraryComponent } from "./NotesLibrary";
import type { NoteItem } from "./types";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

const copy = enNotes.info;
const label = vi.hoisted(() => ({ open1: "Open n1", open2: "Open n2", library: "Library" }));

vi.mock("./NoteDocument", () => ({
  NoteDocument: ({ note, infoPanel }: Parameters<typeof NoteDocumentComponent>[0]) => {
    let place = "panel";
    if (infoPanel === undefined) place = "inline";
    else if (infoPanel === null) place = "none";
    return (
      <div data-testid={`document-${note.id}`} data-info={place}>
        {infoPanel ? createPortal(<p>{`Info for ${note.title}`}</p>, infoPanel) : null}
      </div>
    );
  },
}));

vi.mock("./NotesHome", () => ({ NotesHome: () => <section data-testid="home" /> }));

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

import { NotesDataProvider } from "./notes-data";
import { INFO_VIEW, NOTES_LAYOUT_KEY } from "./notes-layout";
import { NotesWorkspace } from "./NotesWorkspace";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { useSettingsStore } from "@/store/settings";

const notes: NoteItem[] = ["n1", "n2"].map((id) => ({
  id,
  title: `Note ${id}`,
  project: "Vision",
  updatedAt: 1,
  author: "you",
  summary: "",
}));

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

function infoButton(): HTMLElement {
  return screen.getByRole("button", { name: copy.show });
}

function infoPanel(): HTMLElement {
  return screen.getByRole("region", { name: copy.title });
}

function infoShortcut() {
  fireEvent.keyDown(window, { code: "KeyT", key: "T", ctrlKey: true, shiftKey: true });
}

const initialPrefs = useNotesPrefsStore.getState();

beforeEach(() => {
  localStorage.clear();
  useNotesPrefsStore.setState(initialPrefs, true);
  useSettingsStore.getState().setNotesAppearance("notesInfo", "side");
});

afterEach(() => {
  useSettingsStore.getState().setNotesAppearance("notesInfo", "side");
  vi.restoreAllMocks();
});

describe("NotesWorkspace note info", () => {
  it("opens Info beside the note from the header, follows the focused note and closes again", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: label.open1 }));
    expect(screen.getByTestId("document-n1")).toHaveAttribute("data-info", "none");
    expect(infoButton()).toHaveAttribute("aria-pressed", "false");
    await user.click(infoButton());
    expect(infoButton()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("tab", { name: copy.title })).toBeInTheDocument();
    expect(within(infoPanel()).getByText("Info for Note n1")).toBeInTheDocument();
    expect(screen.getByTestId("document-n1")).toHaveAttribute("data-info", "panel");
    expect(savedGroups()).toEqual([["home", "note:n1"], [INFO_VIEW]]);
    await user.click(screen.getByRole("button", { name: label.open2 }));
    expect(within(infoPanel()).getByText("Info for Note n2")).toBeInTheDocument();
    expect(within(infoPanel()).queryByText("Info for Note n1")).not.toBeInTheDocument();
    await user.click(infoButton());
    expect(screen.queryByRole("tab", { name: copy.title })).not.toBeInTheDocument();
    expect(savedGroups()).toEqual([["home", "note:n1", "note:n2"]]);
  });

  it("shows the shortcut in the button's tooltip and answers it", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: label.open1 }));
    await user.hover(infoButton());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      enShell.rail.withShortcut.replace("{{label}}", copy.show).replace("{{shortcut}}", "Ctrl+Shift+T"),
    );
    const properties = useNotesPrefsStore.getState().propertiesOpen;
    infoShortcut();
    expect(screen.getByRole("tab", { name: copy.title })).toBeInTheDocument();
    infoShortcut();
    expect(screen.queryByRole("tab", { name: copy.title })).not.toBeInTheDocument();
    expect(useNotesPrefsStore.getState().propertiesOpen).toBe(properties);
  });

  it("keeps Info open on the next start", async () => {
    const user = userEvent.setup();
    const first = renderWorkspace();
    await user.click(screen.getByRole("button", { name: label.open1 }));
    await user.click(infoButton());
    first.unmount();
    renderWorkspace();
    expect(screen.getByRole("tab", { name: copy.title })).toBeInTheDocument();
    expect(within(infoPanel()).getByText("Info for Note n1")).toBeInTheDocument();
  });

  it("asks for a note when Info has none to show", () => {
    localStorage.setItem(
      NOTES_LAYOUT_KEY,
      JSON.stringify({
        schema: 1,
        root: { kind: "group", id: "g1", views: ["home", INFO_VIEW], active: INFO_VIEW },
        views: { home: { type: "home" }, [INFO_VIEW]: { type: "info" } },
        maximized: null,
      }),
    );
    renderWorkspace();
    expect(within(infoPanel()).getByText(copy.noNote)).toBeInTheDocument();
  });

  it("keeps everything on the page in inline mode, where the shortcut folds the properties", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: label.open1 }));
    await user.click(infoButton());
    act(() => useSettingsStore.getState().setNotesAppearance("notesInfo", "inline"));
    expect(screen.queryByRole("tab", { name: copy.title })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.show })).not.toBeInTheDocument();
    expect(screen.getByTestId("document-n1")).toHaveAttribute("data-info", "inline");
    const properties = useNotesPrefsStore.getState().propertiesOpen;
    infoShortcut();
    expect(useNotesPrefsStore.getState().propertiesOpen).toBe(!properties);
    expect(screen.queryByRole("tab", { name: copy.title })).not.toBeInTheDocument();
    act(() => useSettingsStore.getState().setNotesAppearance("notesInfo", "side"));
    expect(infoButton()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("document-n1")).toHaveAttribute("data-info", "none");
  });
});
