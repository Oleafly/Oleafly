// @vitest-environment jsdom

import type { ProjectInfo } from "@oleafly/backend-port";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import "./tests/setup";

const mocks = vi.hoisted(() => ({
  noteFacts: vi.fn(),
  createNoteProject: vi.fn(),
  readFileContent: vi.fn(),
  logError: vi.fn(),
  createProjectNoteFile: vi.fn(),
  copyProjectNoteToMine: vi.fn(),
  moveNoteIntoProject: vi.fn(),
  renameProjectNote: vi.fn(),
  deleteProjectEntry: vi.fn(),
  confirmAction: vi.fn(),
  setNoteRelatedProject: vi.fn(),
  forgetNoteLeftovers: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  noteFacts: mocks.noteFacts,
  createNoteProject: mocks.createNoteProject,
  readFileContent: mocks.readFileContent,
  setNoteRelatedProject: mocks.setNoteRelatedProject,
}));
vi.mock("@/lib/project-file-delete", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/project-file-delete")>()),
  deleteProjectEntry: mocks.deleteProjectEntry,
}));
vi.mock("@/store/confirm-dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/confirm-dialog")>()),
  confirmAction: mocks.confirmAction,
}));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: mocks.logError,
}));
vi.mock("./note-pending-suggestions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./note-pending-suggestions")>()),
  forgetNoteLeftovers: mocks.forgetNoteLeftovers,
}));
vi.mock("./project-note-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./project-note-actions")>()),
  createProjectNoteFile: mocks.createProjectNoteFile,
  copyProjectNoteToMine: mocks.copyProjectNoteToMine,
  moveNoteIntoProject: mocks.moveNoteIntoProject,
  renameProjectNote: mocks.renameProjectNote,
}));

import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { projectNoteKey } from "@/lib/project-notes";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useNoteTabsStore } from "@/store/note-tabs";
import { useNotesViewStore } from "@/store/notes-view";
import { useToastStore } from "@/store/toast";
import { PROJECT_NOTES_SEARCH_MIN, ProjectNotesPanel } from "./ProjectNotesPanel";

const NOW = Math.floor(Date.now() / 1000);

function project(id: string, overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id,
    name: id,
    main_doc: "note.md",
    kind: "note",
    created_at: 1,
    updated_at: NOW - 3600,
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
    related_project: "paper",
    ...overrides,
  };
}

const PAPER = project("paper", { name: "Paper", kind: "document", main_doc: "main.tex", related_project: null });
const MASKING = project("masking", { name: "Masking ablation", updated_at: NOW - 60 });
const READING = project("reading", { name: "Reading list", updated_at: NOW - 7200 });
const OTHER = project("other", { name: "Unrelated idea", related_project: "thesis" });

const MASKING_FACTS = {
  id: "masking",
  noteId: null,
  title: "Masking ablation",
  icon: "lucide:atom",
  color: "mint",
  agent: null,
  tags: [],
  aliases: [],
  properties: {},
  preview: "Sweep over masking ratios.",
  relatedProject: "paper",
  updatedAt: 1,
  knowledge: "k",
};
const PLAN = "---\ntitle: Lab plan\nkind: note\nid: p1\ncolor: rose\nicon: lucide:atom\n---\n\nRun the sweep twice.\n";
const AGENDA = "---\nkind: note\n---\n\nWeekly agenda.\n";
const PLAIN = "# Not a note\n";

const saved = {
  files: useFilesStore.getState(),
  home: useHomeViewStore.getState(),
  notesView: useNotesViewStore.getState(),
};

let refreshProjects = vi.fn(async () => {});

function mineRows() {
  return screen.queryAllByTestId("project-note");
}

function fileRows() {
  return screen.queryAllByTestId("project-note-file");
}

function openMenu(button: HTMLElement) {
  fireEvent.pointerDown(button, { button: 0, ctrlKey: false, pointerType: "mouse" });
}

beforeEach(() => {
  vi.clearAllMocks();
  refreshProjects = vi.fn(async () => {});
  mocks.noteFacts.mockResolvedValue([MASKING_FACTS]);
  mocks.readFileContent.mockImplementation(async (_projectId: string, path: string) => {
    if (path === "notes/Plan.md") return PLAN;
    if (path === "notes/Agenda.md") return AGENDA;
    if (path === "notes/Broken.md") throw new Error("gone");
    return PLAIN;
  });
  useFilesStore.setState({
    projectId: "paper",
    projects: [PAPER, READING, MASKING, OTHER],
    refreshProjects,
    tree: [
      { path: "main.tex", is_dir: false },
      { path: "notes", is_dir: true },
      { path: "notes/Plan.md", is_dir: false },
      { path: "notes/Agenda.md", is_dir: false },
      { path: "notes/readme.md", is_dir: false },
      { path: "notes/Broken.md", is_dir: false },
      { path: "notes/assets/fig.md", is_dir: false },
    ],
    files: {},
  });
  useHomeViewStore.setState({ page: "library" });
  useNotesViewStore.setState({ requestedNoteId: null });
  useNoteTabsStore.setState({ tabs: [], active: null, markdown: {} });
  useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false, connecting: false });
  useToastStore.getState().reset();
});

afterEach(() => {
  useFilesStore.setState(saved.files, true);
  useHomeViewStore.setState(saved.home, true);
  useNotesViewStore.setState(saved.notesView, true);
});

describe("ProjectNotesPanel", () => {
  it("lists project notes from the notes folder and personal notes in their own groups", async () => {
    render(<ProjectNotesPanel />);
    expect(screen.getByRole("heading", { name: enShell.rail.notes })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: enNotes.projectNotes.projectGroup })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: enNotes.projectNotes.mineGroup })).toBeInTheDocument();
    await waitFor(() => expect(fileRows()).toHaveLength(2));
    expect(fileRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("Agenda"),
      expect.stringContaining("Lab plan"),
    ]);
    expect(screen.getByRole("button", { name: "Lab plan" })).toHaveAccessibleDescription("Run the sweep twice.");
    expect(mocks.readFileContent).not.toHaveBeenCalledWith("paper", "notes/assets/fig.md");
    expect(mineRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("Masking ablation"),
      expect.stringContaining("Reading list"),
    ]);
    expect(screen.queryByText("Unrelated idea")).toBeNull();
    expect(await screen.findByText("Sweep over masking ratios.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reading list" })).toHaveAccessibleDescription(
      expect.stringMatching(/^Edited /),
    );
    expect(screen.queryByTestId("project-notes-shared")).toBeNull();
  });

  it("uses the open file's text over what it read from disk", async () => {
    useFilesStore.setState({ files: { "notes/Plan.md": { content: PLAN.replace("Lab plan", "Lab plan v2"), dirty: false } } });
    render(<ProjectNotesPanel />);
    expect(await screen.findByRole("button", { name: "Lab plan v2" })).toBeInTheDocument();
  });

  it("opens a project note as a file tab and a personal note as a note tab", async () => {
    const openFile = vi.fn(async () => {});
    useFilesStore.setState({ openFile });
    render(<ProjectNotesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Lab plan" }));
    expect(openFile).toHaveBeenCalledWith("notes/Plan.md");
    fireEvent.click(screen.getByRole("button", { name: "Reading list" }));
    expect(useNoteTabsStore.getState().tabs.map((tab) => [tab.projectId, tab.id])).toEqual([["paper", "reading"]]);
    expect(useNoteTabsStore.getState().active).toBe("reading");
    expect(useHomeViewStore.getState().page).toBe("library");
  });

  it("offers copy, move and open in Notes from the row menus", async () => {
    render(<ProjectNotesPanel />);
    await screen.findByRole("button", { name: "Lab plan" });
    openMenu(screen.getAllByTestId("project-note-file-menu")[1]);
    fireEvent.click(await screen.findByTestId("project-note-file-copy"));
    expect(mocks.copyProjectNoteToMine).toHaveBeenCalledWith("paper", "notes/Plan.md");

    openMenu(screen.getAllByTestId("project-note-menu")[0]);
    fireEvent.click(await screen.findByTestId("project-note-move"));
    expect(mocks.moveNoteIntoProject).toHaveBeenCalledWith("masking", "paper");

    openMenu(screen.getAllByTestId("project-note-menu")[1]);
    fireEvent.click(await screen.findByTestId("project-note-open"));
    expect(useHomeViewStore.getState().page).toBe("notes");
    expect(useNotesViewStore.getState().requestedNoteId).toBe("reading");
  });

  it("creates an Untitled project note in one click and renames it in place", async () => {
    mocks.createProjectNoteFile.mockResolvedValueOnce(`notes/${enNotes.document.untitled}.md`);
    mocks.renameProjectNote.mockResolvedValueOnce("notes/Results.md");
    render(<ProjectNotesPanel />);
    fireEvent.click(screen.getByRole("button", { name: enNotes.projectNotes.newProjectNote }));
    await waitFor(() => expect(mocks.createProjectNoteFile).toHaveBeenCalledWith("paper", ""));
    const field = await screen.findByRole("textbox", { name: enNotes.projectNotes.titleLabel });
    expect(field).toHaveFocus();
    expect(field).toHaveValue(enNotes.document.untitled);
    fireEvent.change(field, { target: { value: "Results" } });
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    expect(mocks.renameProjectNote).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(mocks.renameProjectNote).toHaveBeenCalledWith("paper", `notes/${enNotes.document.untitled}.md`, "Results"));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: enNotes.projectNotes.titleLabel })).toBeNull());
    expect(mocks.createProjectNoteFile).toHaveBeenCalledTimes(1);
  });

  it("keeps the Untitled name when renaming is cancelled or left unchanged", async () => {
    mocks.createProjectNoteFile.mockResolvedValue(`notes/${enNotes.document.untitled}.md`);
    render(<ProjectNotesPanel />);
    const newButton = screen.getByRole("button", { name: enNotes.projectNotes.newProjectNote });
    fireEvent.click(newButton);
    fireEvent.keyDown(await screen.findByRole("textbox", { name: enNotes.projectNotes.titleLabel }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: enNotes.projectNotes.titleLabel })).toBeNull();
    await waitFor(() => expect(newButton).toBeEnabled());
    fireEvent.click(newButton);
    fireEvent.blur(await screen.findByRole("textbox", { name: enNotes.projectNotes.titleLabel }));
    expect(screen.queryByRole("textbox", { name: enNotes.projectNotes.titleLabel })).toBeNull();
    expect(mocks.renameProjectNote).not.toHaveBeenCalled();
  });

  it("renames and deletes project notes and unlinks personal notes from the row menus", async () => {
    mocks.renameProjectNote.mockResolvedValueOnce("notes/Lab notes.md");
    mocks.deleteProjectEntry.mockResolvedValueOnce(true);
    mocks.confirmAction.mockResolvedValueOnce(true);
    mocks.setNoteRelatedProject.mockResolvedValueOnce(undefined);
    render(<ProjectNotesPanel />);
    await screen.findByRole("button", { name: "Lab plan" });
    openMenu(screen.getAllByTestId("project-note-file-menu")[1]);
    fireEvent.click(await screen.findByTestId("project-note-file-rename"));
    const field = screen.getByRole("textbox", { name: enNotes.projectNotes.titleLabel });
    expect(field).toHaveValue("Lab plan");
    fireEvent.change(field, { target: { value: "Lab notes" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(mocks.renameProjectNote).toHaveBeenCalledWith("paper", "notes/Plan.md", "Lab notes"));

    openMenu(screen.getAllByTestId("project-note-file-menu")[1]);
    fireEvent.click(await screen.findByTestId("project-note-file-delete"));
    await waitFor(() => expect(mocks.forgetNoteLeftovers).toHaveBeenCalledWith(projectNoteKey("paper", "notes/Plan.md")));
    expect(mocks.deleteProjectEntry).toHaveBeenCalledWith("notes/Plan.md");
    expect(mocks.confirmAction).toHaveBeenCalledWith({
      title: enNotes.projectNotes.deleteTitle.replace("{{name}}", "Lab plan"),
      message: enNotes.projectNotes.deleteMessage,
      confirmLabel: enCommon.actions.delete,
      destructive: true,
    });

    openMenu(screen.getAllByTestId("project-note-menu")[0]);
    fireEvent.click(await screen.findByTestId("project-note-unlink"));
    await waitFor(() => expect(mocks.setNoteRelatedProject).toHaveBeenCalledWith("masking", null));
    expect(screen.getByTestId("project-notes-device")).toHaveTextContent(enNotes.projectNotes.mineDeviceOnly);
  });

  it("says a project note in an opened folder goes to the Trash, and a personal note to the Recycle Bin", async () => {
    useFilesStore.setState({ manifestHome: "device" });
    mocks.confirmAction.mockResolvedValueOnce(false);
    render(<ProjectNotesPanel />);
    await screen.findByRole("button", { name: "Lab plan" });
    openMenu(screen.getAllByTestId("project-note-file-menu")[1]);
    const trash = await screen.findByTestId("project-note-file-delete");
    expect(trash).toHaveTextContent(enNotes.projectNotes.trash);
    fireEvent.click(trash);
    await waitFor(() =>
      expect(mocks.confirmAction).toHaveBeenCalledWith({
        title: enNotes.projectNotes.trashTitle.replace("{{name}}", "Lab plan"),
        message: enNotes.projectNotes.trashMessage,
        confirmLabel: enNotes.projectNotes.trash,
        destructive: true,
      }),
    );
    expect(mocks.deleteProjectEntry).not.toHaveBeenCalled();

    openMenu(screen.getAllByTestId("project-note-menu")[0]);
    expect(await screen.findByTestId("project-note-delete")).toHaveTextContent(enNotes.library.menu.deleteConfirm);
  });

  it("unlinks a personal note with an Undo that links it back", async () => {
    mocks.setNoteRelatedProject.mockResolvedValue(undefined);
    render(<ProjectNotesPanel />);
    await screen.findByRole("button", { name: "Masking ablation" });
    openMenu(screen.getAllByTestId("project-note-menu")[0]);
    fireEvent.click(await screen.findByTestId("project-note-unlink"));
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const [shown] = useToastStore.getState().toasts;
    expect(shown).toMatchObject({
      kind: "success",
      message: enNotes.projectNotes.unlinked.replace("{{title}}", "Masking ablation"),
      action: { label: enNotes.projectNotes.undoUnlink },
    });
    act(() => shown.action?.onClick());
    await waitFor(() => expect(mocks.setNoteRelatedProject).toHaveBeenLastCalledWith("masking", "paper"));
  });

  it("says when a note could not be unlinked", async () => {
    mocks.setNoteRelatedProject.mockRejectedValueOnce(new Error("locked"));
    render(<ProjectNotesPanel />);
    await screen.findByRole("button", { name: "Masking ablation" });
    openMenu(screen.getAllByTestId("project-note-menu")[0]);
    fireEvent.click(await screen.findByTestId("project-note-unlink"));
    await waitFor(() =>
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        kind: "error",
        message: enNotes.projectNotes.unlinkFailed.replace("{{title}}", "Masking ablation"),
      }),
    );
  });

  it("does not cancel a title while an input method ends its composition with Escape", async () => {
    mocks.createProjectNoteFile.mockResolvedValueOnce(`notes/${enNotes.document.untitled}.md`);
    render(<ProjectNotesPanel />);
    fireEvent.click(screen.getByRole("button", { name: enNotes.projectNotes.newProjectNote }));
    const field = await screen.findByRole("textbox", { name: enNotes.projectNotes.titleLabel });
    fireEvent.keyDown(field, { key: "Escape", keyCode: 229 });
    fireEvent.keyDown(field, { key: "Escape", isComposing: true });
    expect(screen.getByRole("textbox", { name: enNotes.projectNotes.titleLabel })).toBe(field);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: enNotes.projectNotes.titleLabel })).toBeNull();
  });

  it("explains empty groups", async () => {
    useFilesStore.setState({ projects: [PAPER, OTHER], tree: [{ path: "main.tex", is_dir: false }] });
    render(<ProjectNotesPanel />);
    expect(screen.getByTestId("project-files-empty")).toHaveTextContent(enNotes.projectNotes.projectEmpty);
    expect(screen.getByTestId("project-notes-empty")).toHaveTextContent(enNotes.projectNotes.mineEmpty);
    expect(mocks.noteFacts).not.toHaveBeenCalled();
    expect(mocks.readFileContent).not.toHaveBeenCalled();
  });

  it("creates one personal note at a time and opens it as a tab", async () => {
    let finish: (id: string) => void = () => {};
    mocks.createNoteProject.mockImplementation(() => new Promise<string>((resolve) => (finish = resolve)));
    render(<ProjectNotesPanel />);
    const button = screen.getByRole("button", { name: enNotes.projectNotes.newPersonalNote });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    await act(async () => {
      finish("fresh");
    });
    await waitFor(() => expect(button).toBeEnabled());
    expect(mocks.createNoteProject).toHaveBeenCalledOnce();
    expect(mocks.createNoteProject).toHaveBeenCalledWith(enNotes.document.untitled, expect.any(String), "paper");
    expect(useNoteTabsStore.getState().active).toBe("fresh");
  });

  it("cannot start notes without an open project", () => {
    useFilesStore.setState({ projectId: null });
    render(<ProjectNotesPanel />);
    expect(screen.getByRole("button", { name: enNotes.projectNotes.newPersonalNote })).toBeDisabled();
    expect(screen.getByRole("button", { name: enNotes.projectNotes.newProjectNote })).toBeDisabled();
    expect(mocks.readFileContent).not.toHaveBeenCalled();
  });

  it("says what is shared in a shared project", async () => {
    useFilesStore.setState({ projects: [{ ...PAPER, shared: { server_name: "Lab", role: "owner" } }, READING] });
    const { unmount } = render(<ProjectNotesPanel />);
    expect(screen.getByTestId("project-notes-shared")).toHaveTextContent(enNotes.projectNotes.sharedLine);
    unmount();
    useFilesStore.setState({ projects: [PAPER, READING] });
    useCollabEditorGate.setState({ projectId: "paper" });
    render(<ProjectNotesPanel />);
    expect(screen.getByTestId("project-notes-shared")).toBeInTheDocument();
  });

  it("offers search past eight notes and filters both groups", async () => {
    const many = Array.from({ length: PROJECT_NOTES_SEARCH_MIN - 2 }, (_, index) =>
      project(`n${index}`, { name: `Experiment ${index}`, updated_at: NOW - 100 - index }),
    );
    useFilesStore.setState({ projects: [PAPER, ...many] });
    const { rerender } = render(<ProjectNotesPanel />);
    await waitFor(() => expect(fileRows()).toHaveLength(2));
    expect(screen.queryByRole("searchbox")).toBeNull();

    useFilesStore.setState({ projects: [PAPER, MASKING, ...many] });
    rerender(<ProjectNotesPanel />);
    const search = screen.getByRole("searchbox", { name: enNotes.projectNotes.searchLabel });
    expect(search).toHaveAttribute("placeholder", enNotes.projectNotes.searchPlaceholder);
    await screen.findByText("Sweep over masking ratios.");

    fireEvent.change(search, { target: { value: "RATIOS" } });
    expect(mineRows()).toHaveLength(1);
    expect(fileRows()).toHaveLength(0);

    fireEvent.change(search, { target: { value: "sweep twice" } });
    expect(fileRows()).toHaveLength(1);
    expect(mineRows()).toHaveLength(0);

    fireEvent.change(search, { target: { value: "nothing like this" } });
    expect(screen.getByRole("status")).toHaveTextContent(enNotes.projectNotes.noMatches);

    fireEvent.click(screen.getByRole("button", { name: enNotes.projectNotes.clearSearch }));
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(mineRows()).toHaveLength(PROJECT_NOTES_SEARCH_MIN - 1);
    expect(fileRows()).toHaveLength(2);
  });

  it("re-reads the personal notes when Notes closes, and not while it is open", async () => {
    const view = render(<ProjectNotesPanel />);
    await waitFor(() => expect(mocks.noteFacts).toHaveBeenCalledOnce());
    act(() => useHomeViewStore.setState({ page: "notes" }));
    view.rerender(<ProjectNotesPanel />);
    expect(mocks.noteFacts).toHaveBeenCalledOnce();
    expect(refreshProjects).not.toHaveBeenCalled();

    act(() => useHomeViewStore.setState({ page: "library" }));
    await waitFor(() => expect(mocks.noteFacts).toHaveBeenCalledTimes(2));
    expect(refreshProjects).toHaveBeenCalledOnce();
  });

  it("logs facts and project lists it cannot read", async () => {
    const heads = new Error("no facts");
    const list = new Error("no list");
    mocks.noteFacts.mockRejectedValue(heads);
    refreshProjects.mockRejectedValue(list);
    useHomeViewStore.setState({ page: "notes" });
    render(<ProjectNotesPanel />);
    act(() => useHomeViewStore.setState({ page: "library" }));
    await waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("read project note facts", heads));
    expect(mocks.logError).toHaveBeenCalledWith("refresh projects after closing notes", list);
    expect(mineRows()).toHaveLength(2);
  });

  it("ignores facts that arrive after it closes", async () => {
    let deliver: (value: (typeof MASKING_FACTS)[]) => void = () => {};
    mocks.noteFacts.mockImplementation(() => new Promise((resolve) => (deliver = resolve)));
    const { unmount } = render(<ProjectNotesPanel />);
    unmount();
    await act(async () => {
      deliver([MASKING_FACTS]);
    });
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("announces that project notes are loading", () => {
    mocks.readFileContent.mockImplementation(() => new Promise(() => {}));
    render(<ProjectNotesPanel />);
    const group = screen.getByTestId("project-notes-files");
    expect(within(group).getByRole("status")).toHaveTextContent(enNotes.projectNotes.loading);
    expect(within(group).queryByTestId("project-files-empty")).toBeNull();
    expect(fileRows()).toHaveLength(0);
  });
});
