// @vitest-environment jsdom

import type { ProjectInfo } from "@oleafly/backend-port";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { NotesData } from "./notes-data";
import type { NotesWorkspace } from "./NotesWorkspace";

type WorkspaceProps = Parameters<typeof NotesWorkspace>[0];

const mocks = vi.hoisted(() => ({
  noteHeads: vi.fn(),
  createNoteProject: vi.fn(),
  readFileContent: vi.fn(),
  logError: vi.fn(),
  canCreate: true,
}));
const captured = vi.hoisted(() => ({
  props: null as WorkspaceProps | null,
  data: null as NotesData | null,
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  noteHeads: mocks.noteHeads,
  createNoteProject: mocks.createNoteProject,
  readFileContent: mocks.readFileContent,
}));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: mocks.logError,
}));
vi.mock("./notes-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./notes-service")>();
  return {
    ...actual,
    createNotesService: (deps: Parameters<typeof actual.createNotesService>[0]) => {
      const service = actual.createNotesService(deps);
      return mocks.canCreate ? service : { ...service, createNote: undefined };
    },
  };
});
vi.mock("./NotesWorkspace", async () => {
  const { useNotesData } = await import("./notes-data");
  return {
    NotesWorkspace: (props: WorkspaceProps) => {
      const data = useNotesData();
      captured.props = props;
      captured.data = data;
      return <p data-testid="workspace">{data.notes.map((note) => note.title).join(", ")}</p>;
    },
  };
});

import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useNotesViewStore } from "@/store/notes-view";
import { useSettingsStore } from "@/store/settings";
import { newNoteSource } from "./note-file";
import { NotesHost } from "./NotesHost";

function project(overrides: Partial<ProjectInfo> & Pick<ProjectInfo, "id" | "name" | "kind">): ProjectInfo {
  return {
    main_doc: "note.md",
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
    ...overrides,
  };
}

const projects: ProjectInfo[] = [
  project({ id: "paper-1", name: "Masking paper", kind: "latex", main_doc: "main.tex" }),
  project({ id: "note-1", name: "Masking ablation", kind: "note", related_project: "paper-1", updated_at: 1_700_000_100 }),
  project({ id: "note-2", name: "Reading list", kind: "note", updated_at: 1_700_000_200 }),
];

const HEAD = "---\ntitle: Masking ablation\nagent: Codex\nicon: lucide:atom\n---\n\nSweep over masking ratios.\n";

const saved = {
  files: useFilesStore.getState(),
  home: useHomeViewStore.getState(),
  notesView: useNotesViewStore.getState(),
  settings: useSettingsStore.getState(),
};

let refreshProjects = vi.fn();

function props(): WorkspaceProps {
  if (!captured.props) throw new Error("the workspace was not rendered");
  return captured.props;
}

function data(): NotesData {
  if (!captured.data) throw new Error("the workspace was not rendered");
  return captured.data;
}

function openNotes() {
  useHomeViewStore.setState({ page: "notes" });
  useSettingsStore.setState({ notes: true });
}

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canCreate = true;
  captured.props = null;
  captured.data = null;
  refreshProjects = vi.fn(() => Promise.resolve());
  useFilesStore.setState({ projects, refreshProjects });
  useNotesViewStore.setState({ requestedNoteId: null });
  mocks.noteHeads.mockResolvedValue([{ id: "note-1", head: HEAD }]);
});

afterEach(() => {
  useFilesStore.setState(saved.files, true);
  useHomeViewStore.setState(saved.home, true);
  useNotesViewStore.setState(saved.notesView, true);
  useSettingsStore.setState(saved.settings, true);
});

describe("NotesHost", () => {
  it("renders nothing while another home page is showing", () => {
    useHomeViewStore.setState({ page: "library" });
    useSettingsStore.setState({ notes: true });
    const { container } = render(<NotesHost />);
    expect(container).toBeEmptyDOMElement();
    expect(mocks.noteHeads).not.toHaveBeenCalled();
    expect(refreshProjects).not.toHaveBeenCalled();
  });

  it("sends the user back to the library when Notes is opened with the setting off", () => {
    useHomeViewStore.setState({ page: "notes" });
    useSettingsStore.setState({ notes: false });
    const { container } = render(<NotesHost />);
    expect(container).toBeEmptyDOMElement();
    expect(useHomeViewStore.getState().page).toBe("library");
  });

  it("closes Notes and returns to the library when the setting is turned off", async () => {
    openNotes();
    render(<NotesHost />);
    expect(await screen.findByTestId("workspace")).toBeInTheDocument();
    act(() => useSettingsStore.setState({ notes: false }));
    expect(useHomeViewStore.getState().page).toBe("library");
    expect(screen.queryByTestId("workspace")).not.toBeInTheDocument();
  });

  it("lists note projects with the facts read from each note's head", async () => {
    openNotes();
    render(<NotesHost />);
    expect(refreshProjects).toHaveBeenCalledOnce();
    expect(mocks.noteHeads).toHaveBeenCalledOnce();
    await waitFor(() => expect(data().notes[0].agent).toBe("Codex"));
    expect(data().notes).toEqual([
      {
        id: "note-1",
        title: "Masking ablation",
        project: "Masking paper",
        updatedAt: 1_700_000_100_000,
        author: "agent",
        agent: "Codex",
        icon: "lucide:atom",
        summary: "Sweep over masking ratios.",
      },
      {
        id: "note-2",
        title: "Reading list",
        project: enNotes.library.ungrouped,
        updatedAt: 1_700_000_200_000,
        author: "you",
        agent: undefined,
        icon: undefined,
        summary: "",
      },
    ]);
    expect(data().artifacts).toEqual([]);
    expect(data().experiments).toEqual([]);
    expect(data().agents).toEqual([]);
    expect(data().citations).toEqual([]);
    expect(data().papers).toEqual([]);
    expect(screen.getByTestId("workspace")).toHaveTextContent("Masking ablation, Reading list");
  });

  it("follows the project list as it changes", async () => {
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    act(() =>
      useFilesStore.setState({
        projects: [...projects, project({ id: "note-3", name: "Fresh idea", kind: "note" })],
      }),
    );
    expect(screen.getByTestId("workspace")).toHaveTextContent("Masking ablation, Reading list, Fresh idea");
  });

  it("logs and keeps going when note heads cannot be read", async () => {
    const failure = new Error("no heads");
    mocks.noteHeads.mockRejectedValue(failure);
    openNotes();
    render(<NotesHost />);
    await waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("read note heads", failure));
    expect(data().notes.map((note) => note.author)).toEqual(["you", "you"]);
  });

  it("opens the note another screen asked for, once", async () => {
    useNotesViewStore.setState({ requestedNoteId: "note-2" });
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    expect(props().initialNoteId).toBe("note-2");
    expect(useNotesViewStore.getState().requestedNoteId).toBeNull();
  });

  it("starts on Home when no note was asked for", async () => {
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    expect(props().initialNoteId).toBeNull();
  });

  it("returns to the library when the workspace exits", async () => {
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    act(() => props().onExit?.());
    expect(useHomeViewStore.getState().page).toBe("library");
    expect(screen.queryByTestId("workspace")).not.toBeInTheDocument();
  });

  it("creates an untitled note project and hands back its id", async () => {
    mocks.createNoteProject.mockResolvedValue("note-3");
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    let created: string | null | undefined;
    await act(async () => {
      created = await props().onNewNote?.();
    });
    expect(created).toBe("note-3");
    const untitled = enNotes.document.untitled;
    expect(mocks.createNoteProject).toHaveBeenCalledWith(untitled, newNoteSource(untitled));
    expect(refreshProjects).toHaveBeenCalledTimes(2);
    expect(mocks.noteHeads).toHaveBeenCalledTimes(2);
  });

  it("logs a failed note creation and hands back no id", async () => {
    const failure = new Error("disk full");
    mocks.createNoteProject.mockRejectedValue(failure);
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    let created: string | null | undefined;
    await act(async () => {
      created = await props().onNewNote?.();
    });
    expect(created).toBeNull();
    expect(mocks.logError).toHaveBeenCalledWith("create note", failure);
  });

  it("hands back no id when notes cannot be created here", async () => {
    mocks.canCreate = false;
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    let created: string | null | undefined;
    await act(async () => {
      created = await props().onNewNote?.();
    });
    expect(created).toBeNull();
    expect(mocks.createNoteProject).not.toHaveBeenCalled();
  });

  it("loads a note from the main document of the latest project list", async () => {
    mocks.readFileContent.mockResolvedValue("# Fresh idea\n");
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    act(() =>
      useFilesStore.setState({
        projects: [...projects, project({ id: "note-3", name: "Fresh idea", kind: "note", main_doc: "idea.md" })],
      }),
    );
    const source = await data().loadNote("note-3");
    expect(mocks.readFileContent).toHaveBeenCalledWith("note-3", "idea.md");
    expect(source.text).toBe("# Fresh idea\n");
  });

  it("explains that a note is missing when its project is gone", async () => {
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    await expect(data().loadNote("gone")).rejects.toThrow(enNotes.document.loadFailed);
  });
});
