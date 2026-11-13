// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  copyProjectNoteToMine: vi.fn(async () => "copy"),
  moveNoteIntoProject: vi.fn(async () => "notes/Moved.md"),
  openNotes: vi.fn(async () => {}),
  logError: vi.fn(),
}));

vi.mock("@/components/notes/project-note-actions", () => ({
  copyProjectNoteToMine: mocks.copyProjectNoteToMine,
  moveNoteIntoProject: mocks.moveNoteIntoProject,
}));
vi.mock("@/features/open-tool", () => ({ openNotes: mocks.openNotes }));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: mocks.logError,
}));

import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useFilesStore } from "@/store/files";
import { editsAsMarkdown, useNoteTabsStore } from "@/store/note-tabs";
import { useSettingsStore } from "@/store/settings";
import type { EditorTab } from "./editor-tabs";
import NoteTabMenuItems from "./note-tab-menu";

const shell = en.shell;
const TRIGGER = "tab row";
const NOTE = "---\ntitle: Lab plan\nkind: note\n---\n\nBody\n";
const NOTE_TAB: EditorTab = { kind: "file", id: "notes/Plan.md", order: 1 };
const PERSONAL_TAB: EditorTab = { kind: "note", id: "mine", order: 2 };

function openMenu(tab: EditorTab) {
  render(
    <ContextMenu>
      <ContextMenuTrigger>{TRIGGER}</ContextMenuTrigger>
      <ContextMenuContent data-testid="tab-menu">
        <NoteTabMenuItems tab={tab} />
      </ContextMenuContent>
    </ContextMenu>,
  );
  fireEvent.contextMenu(screen.getByText(TRIGGER));
  return screen.getByTestId("tab-menu");
}

function names(menu: HTMLElement) {
  return within(menu)
    .queryAllByRole("menuitem")
    .map((item) => item.textContent);
}

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ notes: true });
  useFilesStore.setState({
    projectId: "paper",
    projectKind: "document",
    files: {
      "notes/Plan.md": { content: NOTE, dirty: false },
      "readme.md": { content: "# Readme\n", dirty: false },
    },
  });
  useNoteTabsStore.setState({ tabs: [], active: null, markdown: {} });
});

describe("note actions in the editor tab menu", () => {
  it("offers Markdown editing and a copy to my notes for a project note", () => {
    expect(names(openMenu(NOTE_TAB))).toEqual([shell.editAsMarkdown, shell.copyToMyNotes]);
  });

  it("switches a project note to Markdown and back", () => {
    fireEvent.click(within(openMenu(NOTE_TAB)).getByRole("menuitem", { name: shell.editAsMarkdown }));
    expect(editsAsMarkdown(useNoteTabsStore.getState(), "paper", "notes/Plan.md")).toBe(true);
    fireEvent.contextMenu(screen.getByText(TRIGGER));
    fireEvent.click(within(screen.getByTestId("tab-menu")).getByRole("menuitem", { name: shell.editAsNote }));
    expect(editsAsMarkdown(useNoteTabsStore.getState(), "paper", "notes/Plan.md")).toBe(false);
  });

  it("copies a project note to my notes", async () => {
    fireEvent.click(within(openMenu(NOTE_TAB)).getByRole("menuitem", { name: shell.copyToMyNotes }));
    await waitFor(() => expect(mocks.copyProjectNoteToMine).toHaveBeenCalledWith("paper", "notes/Plan.md"));
  });

  it.each([
    ["a plain Markdown file", () => undefined, { kind: "file", id: "readme.md", order: 1 } as EditorTab],
    ["Notes switched off", () => useSettingsStore.setState({ notes: false }), NOTE_TAB],
    ["a project that is itself a note", () => useFilesStore.setState({ projectKind: "note" }), NOTE_TAB],
    ["no open project", () => useFilesStore.setState({ projectId: null }), NOTE_TAB],
  ])("adds nothing for %s", (_name, arrange, tab) => {
    arrange();
    expect(names(openMenu(tab))).toEqual([]);
  });

  it("opens a personal note in Notes or moves it into the open project", async () => {
    const menu = openMenu(PERSONAL_TAB);
    expect(names(menu)).toEqual([shell.openInNotes, shell.moveIntoProject]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: shell.openInNotes }));
    await waitFor(() => expect(mocks.openNotes).toHaveBeenCalledWith("mine"));
    fireEvent.contextMenu(screen.getByText(TRIGGER));
    fireEvent.click(within(screen.getByTestId("tab-menu")).getByRole("menuitem", { name: shell.moveIntoProject }));
    await waitFor(() => expect(mocks.moveNoteIntoProject).toHaveBeenCalledWith("mine", "paper"));
  });

  it("adds nothing for a personal note without an open project, or for a diff", () => {
    useFilesStore.setState({ projectId: null });
    expect(names(openMenu(PERSONAL_TAB))).toEqual([]);
    cleanup();
    useFilesStore.setState({ projectId: "paper" });
    const diff: EditorTab = { kind: "diff", id: "notes/Plan.md", d: { path: "notes/Plan.md", side: "working", order: 3 }, order: 3 };
    expect(names(openMenu(diff))).toEqual([]);
  });

  it("logs each note action that fails", async () => {
    const failure = new Error("offline");
    mocks.copyProjectNoteToMine.mockRejectedValueOnce(failure);
    mocks.openNotes.mockRejectedValueOnce(failure);
    fireEvent.click(within(openMenu(NOTE_TAB)).getByRole("menuitem", { name: shell.copyToMyNotes }));
    await waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("copy a project note to my notes", failure));
    cleanup();
    fireEvent.click(within(openMenu(PERSONAL_TAB)).getByRole("menuitem", { name: shell.openInNotes }));
    await waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("open a note in Notes", failure));
  });
});
