// @vitest-environment jsdom

import type { ProjectInfo } from "@oleafly/backend-port";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { NotesData } from "./notes-data";
import type { NoteItem } from "./types";

const mocks = vi.hoisted(() => ({
  noteHeads: vi.fn(),
  projectCitations: vi.fn(),
  copyProjectNoteToMine: vi.fn(async () => "copy"),
  moveNoteIntoProject: vi.fn(async () => "notes/x.md"),
  openNotes: vi.fn(async () => {}),
  logError: vi.fn(),
  seen: [] as {
    note: NoteItem;
    data: NotesData;
    live: unknown;
    onOpenNote?: (id: string, options: { newTab: boolean }) => void;
    onStatusChange?: (status: "saved" | "saving" | "failed", failure: { error: unknown; retry: () => void } | null) => void;
  }[],
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  noteHeads: mocks.noteHeads,
}));
vi.mock("./note-citations", () => ({ projectCitations: mocks.projectCitations }));
vi.mock("./project-note-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./project-note-actions")>()),
  copyProjectNoteToMine: mocks.copyProjectNoteToMine,
  moveNoteIntoProject: mocks.moveNoteIntoProject,
}));
vi.mock("@/features/open-tool", () => ({ openNotes: mocks.openNotes }));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: mocks.logError,
}));
vi.mock("./NoteDocument", async () => {
  const { useNotesData } = await import("./notes-data");
  return {
    NoteDocument: (props: {
      note: NoteItem;
      live?: unknown;
      onOpenNote?: (id: string, options: { newTab: boolean }) => void;
      onStatusChange?: (status: "saved" | "saving" | "failed", failure: { error: unknown; retry: () => void } | null) => void;
    }) => {
      const data = useNotesData();
      mocks.seen.push({
        note: props.note,
        data,
        live: props.live,
        onOpenNote: props.onOpenNote,
        onStatusChange: props.onStatusChange,
      });
      return <div data-testid="note-document">{props.note.title}</div>;
    },
  };
});

import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { useFilesStore } from "@/store/files";
import { useNoteTabsStore } from "@/store/note-tabs";
import { forgetNoteTabHeads, noteListSignature } from "./note-tab-data";
import { PersonalNoteTab, ProjectNoteTab } from "./NoteTabView";

const PATH = "notes/Plan.md";
const NOTE = "---\ntitle: Lab plan\nkind: note\nid: p1\nicon: lucide:atom\ncolor: mint\n---\n\nBody\n";
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
  related_project: "paper",
};
const PAPER: ProjectInfo = { ...PERSONAL, id: "paper", name: "Paper", kind: "document", main_doc: "main.tex", related_project: null };

function latest() {
  const last = mocks.seen.at(-1);
  if (!last) throw new Error("NoteDocument never rendered");
  return last;
}

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  vi.clearAllMocks();
  forgetNoteTabHeads();
  mocks.seen = [];
  mocks.noteHeads.mockResolvedValue([{ id: "mine", head: "---\ntitle: Reading list\nicon: lucide:book\ncolor: rose\n---\n\nPapers.\n" }]);
  mocks.projectCitations.mockResolvedValue([{ key: "smith2020", label: "Smith 2020" }]);
  useFilesStore.setState({
    projectId: "paper",
    projectName: "Paper",
    projects: [PAPER, PERSONAL],
    projectsLoaded: true,
    files: { [PATH]: { content: NOTE, dirty: false } },
  });
  useNoteTabsStore.setState({ tabs: [{ id: "mine", projectId: "paper", order: 1 }], active: "mine", markdown: {} });
  useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false, connecting: false });
});

describe("project note tab", () => {
  it("renders the note from its file with this project as its home", async () => {
    render(<ProjectNoteTab projectId="paper" path={PATH} />);
    expect(screen.getByTestId("note-document")).toHaveTextContent("Lab plan");
    const { note, live, data } = latest();
    expect(note).toMatchObject({
      id: "project-note:paper:notes/Plan.md",
      title: "Lab plan",
      project: "Paper",
      relatedProjectId: "paper",
      updatedAt: 0,
      icon: "lucide:atom",
      color: "mint",
      home: { projectId: "paper", path: PATH },
    });
    expect(note.shared).toBeUndefined();
    expect(live).toEqual({ projectId: "paper", path: PATH });
    expect(data.importNotebook).toBeUndefined();
    expect(data.renameNote).toBeUndefined();
    expect(data.projectCitations).toBeUndefined();
    await expect(data.loadNote(note.id)).resolves.toMatchObject({ text: NOTE });
    await waitFor(() => expect(latest().data.citations).toEqual([{ key: "smith2020", label: "Smith 2020" }]));
    expect(screen.getByTestId("note-tab-bar")).toHaveTextContent(enNotes.noteTab.localProject);
  });

  it("names a note without a title after its file and says when the project is shared", () => {
    useFilesStore.setState({
      files: { [PATH]: { content: "---\nkind: note\ncolor: plum\n---\n", dirty: false } },
      projects: [{ ...PAPER, shared: { server_name: "Lab", role: "owner" } }, PERSONAL],
    });
    render(<ProjectNoteTab projectId="paper" path={PATH} />);
    expect(latest().note).toMatchObject({ id: "project-note:paper:notes/Plan.md", title: "Plan", shared: true });
    expect(latest().note.color).toBeUndefined();
    expect(screen.getByTestId("note-tab-bar")).toHaveTextContent(enNotes.noteTab.sharedProject);
  });

  it("treats a live shared project as shared", () => {
    useCollabEditorGate.setState({ projectId: "paper" });
    render(<ProjectNoteTab projectId="paper" path={PATH} />);
    expect(latest().note.shared).toBe(true);
  });

  it("shows the save state with its reason and a working Retry", () => {
    render(<ProjectNoteTab projectId="paper" path={PATH} />);
    const bar = screen.getByTestId("note-tab-bar");
    expect(bar.querySelector('[data-note-save-status="saved"]')).not.toBeNull();
    const retry = vi.fn();
    act(() => latest().onStatusChange?.("failed", { error: new Error("The disk is full."), retry }));
    expect(screen.getByRole("alert")).toHaveTextContent("The disk is full.");
    fireEvent.click(screen.getByRole("button", { name: enNotes.saveStatus.retry }));
    expect(retry).toHaveBeenCalledOnce();
    act(() => latest().onStatusChange?.("saving", null));
    expect(bar.querySelector('[data-note-save-status="saving"]')).not.toBeNull();
  });

  it("keeps personal notes out of the link list of a shared project's note", () => {
    useFilesStore.setState({ projects: [{ ...PAPER, shared: { server_name: "Lab", role: "owner" } }, PERSONAL] });
    render(<ProjectNoteTab projectId="paper" path={PATH} />);
    expect(latest().data.notes).toEqual([]);
    expect(latest().data.noteLinks).toBeUndefined();
  });

  it("switches the note to Markdown from the tab bar", () => {
    render(<ProjectNoteTab projectId="paper" path={PATH} />);
    fireEvent.click(screen.getByTestId("note-tab-markdown"));
    expect(useNoteTabsStore.getState().markdown).toEqual({ [`paper\u0000${PATH}`]: true });
  });

  it("copies the note to my notes once while a copy runs and opens linked notes as tabs", async () => {
    let finish: (id: string) => void = () => {};
    mocks.copyProjectNoteToMine.mockImplementationOnce(() => new Promise<string>((resolve) => (finish = resolve)));
    render(<ProjectNoteTab projectId="paper" path={PATH} />);
    fireEvent.click(screen.getByTestId("note-tab-copy"));
    expect(screen.getByTestId("note-tab-copy")).toBeDisabled();
    fireEvent.click(screen.getByTestId("note-tab-copy"));
    expect(mocks.copyProjectNoteToMine).toHaveBeenCalledOnce();
    await act(async () => finish("copy"));
    expect(screen.getByTestId("note-tab-copy")).toBeEnabled();
    expect(mocks.copyProjectNoteToMine).toHaveBeenCalledWith("paper", PATH);
    act(() => latest().onOpenNote?.("linked", { newTab: false }));
    expect(useNoteTabsStore.getState().active).toBe("linked");
  });

  it("logs citations it cannot read and drops late answers", async () => {
    const failure = new Error("no bib");
    mocks.projectCitations.mockRejectedValueOnce(failure);
    const { unmount } = render(<ProjectNoteTab projectId="paper" path={PATH} />);
    await waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("read project citations for a note", failure));
    unmount();
    let deliver: (value: unknown[]) => void = () => {};
    mocks.projectCitations.mockImplementationOnce(() => new Promise((resolve) => (deliver = resolve)));
    const second = render(<ProjectNoteTab projectId="paper" path={PATH} />);
    second.unmount();
    await act(async () => deliver([{ key: "late", label: "Late" }]));
  });

  it("keeps the note's write refusal message current", async () => {
    const setContent = vi.fn(() => false);
    useFilesStore.setState({ setContent });
    render(<ProjectNoteTab projectId="paper" path={PATH} />);
    const { data, note } = latest();
    const disk = await data.loadNote(note.id);
    await expect(data.saveNote(note.id, "x", disk.version)).rejects.toThrow(enNotes.noteTab.writeRefused);
  });
});

describe("personal note tab", () => {
  it("renders the library note with Notes data and remembers its look", async () => {
    render(<PersonalNoteTab projectId="paper" noteId="mine" />);
    expect(await screen.findByTestId("note-document")).toHaveTextContent("Reading list");
    await waitFor(() => expect(useNoteTabsStore.getState().tabs[0]).toMatchObject({ icon: "lucide:book", color: "rose" }));
    expect(latest().data.importNotebook).toBeDefined();
    expect(screen.getByTestId("note-tab-bar")).toHaveTextContent(enNotes.noteTab.private);
  });

  it("says when the personal note is shared from Notes", async () => {
    useFilesStore.setState({ projects: [PAPER, { ...PERSONAL, shared: { server_name: "Lab", role: "owner" } }] });
    render(<PersonalNoteTab projectId="paper" noteId="mine" />);
    expect(await screen.findByTestId("note-tab-bar")).toHaveTextContent(enNotes.noteTab.personalShared);
  });

  it("moves the note into the project, opens it in Notes, and opens links as tabs", async () => {
    render(<PersonalNoteTab projectId="paper" noteId="mine" />);
    fireEvent.click(await screen.findByTestId("note-tab-move"));
    expect(mocks.moveNoteIntoProject).toHaveBeenCalledWith("mine", "paper");
    fireEvent.click(screen.getByTestId("note-tab-open-in-notes"));
    expect(mocks.openNotes).toHaveBeenCalledWith("mine");
    act(() => latest().onOpenNote?.("other", { newTab: true }));
    expect(useNoteTabsStore.getState().active).toBe("other");
  });

  it("waits for the lists, then says when the note is gone", async () => {
    let deliver: (value: unknown[]) => void = () => {};
    mocks.noteHeads.mockImplementationOnce(() => new Promise((resolve) => (deliver = resolve)));
    render(<PersonalNoteTab projectId="paper" noteId="gone" />);
    expect(screen.queryByTestId("personal-note-missing")).toBeNull();
    await act(async () => deliver([]));
    expect(screen.getByTestId("personal-note-missing")).toHaveTextContent(enNotes.noteTab.missing);
  });

  it("waits while projects are still loading", () => {
    useFilesStore.setState({ projectsLoaded: false, projects: [] });
    render(<PersonalNoteTab projectId="paper" noteId="mine" />);
    expect(screen.queryByTestId("personal-note-missing")).toBeNull();
    expect(screen.queryByTestId("note-document")).toBeNull();
  });

  it("still shows the note when its heads cannot be read", async () => {
    const failure = new Error("no heads");
    mocks.noteHeads.mockRejectedValueOnce(failure);
    render(<PersonalNoteTab projectId="paper" noteId="mine" />);
    expect(await screen.findByTestId("note-document")).toHaveTextContent("Reading list");
    expect(mocks.logError).toHaveBeenCalledWith("read note heads for a note tab", failure);
  });

  it("reuses the note list between tab switches until a note changes", async () => {
    const first = render(<PersonalNoteTab projectId="paper" noteId="mine" />);
    await screen.findByTestId("note-document");
    act(() => latest().data.noteTextChanged?.("mine", "---\ntitle: Reading list\nicon: lucide:flask\n---\n"));
    first.unmount();
    const second = render(<PersonalNoteTab projectId="paper" noteId="mine" />);
    expect(screen.getByTestId("note-document")).toBeInTheDocument();
    expect(latest().data.notes[0].icon).toBe("lucide:flask");
    expect(mocks.noteHeads).toHaveBeenCalledOnce();
    second.unmount();
    act(() => useFilesStore.setState({ projects: [PAPER, { ...PERSONAL, updated_at: 99 }] }));
    render(<PersonalNoteTab projectId="paper" noteId="mine" />);
    await waitFor(() => expect(mocks.noteHeads).toHaveBeenCalledTimes(2));
    expect(noteListSignature([PAPER, PERSONAL])).toBe("mine\u00002");
  });

  it("gives the editor a working library", async () => {
    const openProject = vi.fn(async () => {});
    useFilesStore.setState({ openProject });
    render(<PersonalNoteTab projectId="paper" noteId="mine" />);
    await screen.findByTestId("note-document");
    const { data } = latest();
    expect(data.notes.map((note) => note.id)).toEqual(["mine"]);
    expect(data.projects).toEqual([{ id: "paper", name: "Paper" }]);
    expect(data.artifacts).toEqual([]);
    act(() => data.noteTextChanged?.("mine", "---\ntitle: Reading list\nicon: lucide:flask\n---\n"));
    await waitFor(() => expect(latest().data.notes[0].icon).toBe("lucide:flask"));
    data.openProject?.("paper");
    expect(openProject).toHaveBeenCalledWith("paper");
    const failure = new Error("gone");
    openProject.mockRejectedValueOnce(failure);
    data.openProject?.("paper");
    await waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("open a project from a note tab", failure));
  });
});
