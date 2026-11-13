// @vitest-environment jsdom

import type { ProjectInfo } from "@oleafly/backend-port";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

import { useDiffStore } from "@/store/diff";
import { useFilesStore } from "@/store/files";
import { useNoteTabsStore } from "@/store/note-tabs";
import { useSettingsStore } from "@/store/settings";
import { EditorTabStrip } from "./EditorTabStrip";

const shell = en.shell;
const NOTE = "---\ntitle: Lab plan\nkind: note\nicon: lucide:atom\ncolor: mint\n---\n\nBody\n";
const UNTITLED = "---\nkind: note\n---\n\nBody\n";
const PERSONAL: ProjectInfo = {
  id: "mine",
  name: "Reading list",
  main_doc: "note.md",
  kind: "note",
  created_at: 1,
  updated_at: 2,
  has_preview: false,
  exports: [],
  forked_from: null,
  recovery_pending: false,
};

function seed() {
  useSettingsStore.setState({ notes: true });
  useFilesStore.setState({
    projectId: "paper",
    projectKind: "document",
    projects: [PERSONAL],
    files: {
      "main.tex": { content: "x\n", dirty: false },
      "notes/Plan.md": { content: NOTE, dirty: false },
      "notes/Draft.md": { content: UNTITLED, dirty: false },
      "readme.md": { content: "# Readme\n", dirty: false },
    },
    openTabs: ["main.tex", "notes/Plan.md", "notes/Draft.md", "readme.md"],
    tabOrder: { "main.tex": 1, "notes/Plan.md": 2, "notes/Draft.md": 3, "readme.md": 4 },
    assistantTabs: [],
    activePath: "main.tex",
    changedOnDisk: [],
  });
  useDiffStore.setState({ diffs: [], activeKey: null });
  useNoteTabsStore.setState({ tabs: [{ id: "mine", projectId: "paper", order: 5, icon: "lucide:atom" }], active: null, markdown: {} });
}

function menuFor(text: string) {
  fireEvent.contextMenu(screen.getByText(text));
  return screen.getByTestId("editor-tab-menu");
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

describe("note tabs in the editor strip", () => {
  it("labels note files with their title and icon, and other files by name", async () => {
    render(<EditorTabStrip diffFocused={false} />);
    const titles = screen.getAllByTestId("editor-note-tab-title").map((node) => node.textContent);
    expect(titles).toEqual(["Lab plan", "Draft"]);
    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.getByText("main.tex")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll(".note-chip").length).toBeGreaterThan(0));
  });

  it("shows file names when Notes is off or the project is itself a note", () => {
    useSettingsStore.setState({ notes: false });
    const { unmount } = render(<EditorTabStrip diffFocused={false} />);
    expect(screen.getByText("Plan.md")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-personal-note-tab-title")).toBeNull();
    unmount();
    useSettingsStore.setState({ notes: true });
    useFilesStore.setState({ projectKind: "note" });
    render(<EditorTabStrip diffFocused={false} />);
    expect(screen.getByText("Plan.md")).toBeInTheDocument();
  });

  it("switches a note file to Markdown and back from its menu", async () => {
    render(<EditorTabStrip diffFocused={false} />);
    fireEvent.click(await within(menuFor("Lab plan")).findByRole("menuitem", { name: shell.editAsMarkdown }));
    expect(screen.getByText("Plan.md")).toBeInTheDocument();
    fireEvent.click(await within(menuFor("Plan.md")).findByRole("menuitem", { name: shell.editAsNote }));
    expect(screen.getAllByTestId("editor-note-tab-title")[0]).toHaveTextContent("Lab plan");
  });

  it("copies a project note to my notes from its menu", async () => {
    render(<EditorTabStrip diffFocused={false} />);
    fireEvent.click(await within(menuFor("Lab plan")).findByRole("menuitem", { name: shell.copyToMyNotes }));
    await waitFor(() => expect(mocks.copyProjectNoteToMine).toHaveBeenCalledWith("paper", "notes/Plan.md"));
  });

  it("keeps note actions off plain files", async () => {
    render(<EditorTabStrip diffFocused={false} />);
    const menu = menuFor("readme.md");
    expect(await within(menu).findByTestId("editor-tab-menu-close")).toBeInTheDocument();
    expect(within(menu).queryByTestId("editor-tab-menu-note-mode")).toBeNull();
  });

  it("shows personal note tabs, focuses them and marks only them active", () => {
    const { rerender } = render(<EditorTabStrip diffFocused={false} />);
    const title = screen.getByTestId("editor-personal-note-tab-title");
    expect(title).toHaveTextContent("Reading list");
    fireEvent.click(title);
    expect(useNoteTabsStore.getState().active).toBe("mine");
    rerender(<EditorTabStrip diffFocused={false} />);
    expect(title.closest(".bg-muted")).not.toBeNull();
    expect(screen.getByText("main.tex").closest(".bg-muted")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: shell.closeFile.replace("{{name}}", "Reading list") }));
    expect(useNoteTabsStore.getState().tabs).toEqual([]);
  });

  it("names a personal note tab even before the project list knows it", () => {
    useFilesStore.setState({ projects: [] });
    render(<EditorTabStrip diffFocused={false} />);
    expect(screen.getByTestId("editor-personal-note-tab-title")).toHaveTextContent("");
  });

  it("opens a personal note in Notes or moves it into the project from its menu", async () => {
    render(<EditorTabStrip diffFocused={false} />);
    fireEvent.click(await within(menuFor("Reading list")).findByRole("menuitem", { name: shell.openInNotes }));
    await waitFor(() => expect(mocks.openNotes).toHaveBeenCalledWith("mine"));
    fireEvent.click(await within(menuFor("Reading list")).findByRole("menuitem", { name: shell.moveIntoProject }));
    await waitFor(() => expect(mocks.moveNoteIntoProject).toHaveBeenCalledWith("mine", "paper"));
  });

  it("logs note actions that fail", async () => {
    const failure = new Error("offline");
    mocks.moveNoteIntoProject.mockRejectedValueOnce(failure);
    mocks.openNotes.mockRejectedValueOnce(failure);
    render(<EditorTabStrip diffFocused={false} />);
    fireEvent.click(await within(menuFor("Reading list")).findByRole("menuitem", { name: shell.moveIntoProject }));
    await waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("move a note into the project", failure));
    fireEvent.click(await within(menuFor("Reading list")).findByRole("menuitem", { name: shell.openInNotes }));
    await waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("open a note in Notes", failure));
  });

  it("hides personal note tabs while Notes is off", () => {
    useSettingsStore.setState({ notes: false });
    render(<EditorTabStrip diffFocused={false} />);
    expect(screen.queryByTestId("editor-personal-note-tab-title")).toBeNull();
  });

  it("does not mark a diff active while a note tab has focus", () => {
    useDiffStore.setState({ diffs: [{ path: "main.tex", side: "working", order: 9 }], activeKey: "working:main.tex" });
    useNoteTabsStore.setState({ active: "mine" });
    render(<EditorTabStrip diffFocused />);
    const diffRow = screen.getAllByText("main.tex")[1].closest(".bg-muted");
    expect(diffRow).toBeNull();
  });
});
