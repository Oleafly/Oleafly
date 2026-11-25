// @vitest-environment jsdom

import type { ProjectInfo } from "@oleafly/backend-port";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { appQueryClient } from "@/lib/query";
import type { NoteFacts } from "@/lib/tauri";
import type { NotesData } from "./notes-data";
import type { NotesWorkspace } from "./NotesWorkspace";
import "./tests/setup";

type WorkspaceProps = Parameters<typeof NotesWorkspace>[0];

const mocks = vi.hoisted(() => ({
  noteFacts: vi.fn(),
  releaseNoteCaches: vi.fn(),
  noteLinks: vi.fn(),
  setNoteRelatedProject: vi.fn(),
  createNoteProject: vi.fn(),
  claimStarterNote: vi.fn(),
  readFileContent: vi.fn(),
  getConfig: vi.fn(),
  logError: vi.fn(),
  canCreate: true,
}));
const paper = vi.hoisted(() => ({
  pandocConvert: vi.fn(),
  insertAtCursor: vi.fn(),
  readProjectBytes: vi.fn(),
  writeProjectBytes: vi.fn(),
  renderMermaidFigure: vi.fn(),
  svgDocumentToPngBytes: vi.fn(),
  insertUsepackages: vi.fn(),
  notesRenderTikz: vi.fn(),
}));
vi.mock("@/components/editor/cm/controller", () => ({ insertAtCursor: paper.insertAtCursor }));
vi.mock("@/components/diagram/mermaid-render", () => ({ renderMermaidFigure: paper.renderMermaidFigure }));
vi.mock("@/features/equation-export", () => ({ svgDocumentToPngBytes: paper.svgDocumentToPngBytes }));
vi.mock("@/components/packages/latex-document", () => ({ insertUsepackages: paper.insertUsepackages }));
const captured = vi.hoisted(() => ({
  props: null as WorkspaceProps | null,
  data: null as NotesData | null,
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  noteFacts: mocks.noteFacts,
  releaseNoteCaches: mocks.releaseNoteCaches,
  noteLinks: mocks.noteLinks,
  setNoteRelatedProject: mocks.setNoteRelatedProject,
  createNoteProject: mocks.createNoteProject,
  claimStarterNote: mocks.claimStarterNote,
  readFileContent: mocks.readFileContent,
  getConfig: mocks.getConfig,
  readProjectBytes: paper.readProjectBytes,
  writeProjectBytes: paper.writeProjectBytes,
  notesRenderTikz: paper.notesRenderTikz,

setActiveProject: vi.fn().mockResolvedValue(undefined),
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

import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useNotesViewStore } from "@/store/notes-view";
import { useSettingsStore } from "@/store/settings";
import { newNoteSource, noteColorFor, readNoteFacts } from "./note-file";
import { splitNoteSource } from "./note-templates";
import { noteVersion } from "./notes-service";
import { NotesHost, paperFormat, sendTextToPaper } from "./NotesHost";
import shipped from "./tests/blocks-gallery.md?raw";

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

function facts(id: string, overrides: Partial<NoteFacts> = {}): NoteFacts {
  return {
    id,
    noteId: `n-${id}`,
    title: id,
    icon: null,
    color: null,
    agent: null,
    tags: [],
    aliases: [],
    properties: {},
    preview: "",
    relatedProject: null,
    updatedAt: 1,
    knowledge: id,
    taskDigest: id,
    ...overrides,
  };
}

const vault = new Map<string, NoteFacts>();
const MASKING = facts("note-1", { agent: "Codex", icon: "lucide:atom", preview: "Sweep over masking ratios." });

const saved = {
  files: useFilesStore.getState(),
  home: useHomeViewStore.getState(),
  notesView: useNotesViewStore.getState(),
  settings: useSettingsStore.getState(),
};

let refreshProjects = vi.fn();
const toastError = vi.spyOn(toast, "error").mockImplementation(() => 0);

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canCreate = true;
  captured.props = null;
  captured.data = null;
  refreshProjects = vi.fn(() => Promise.resolve());
  useFilesStore.setState({ projects, projectsLoaded: true, refreshProjects });
  useNotesViewStore.setState({ requestedNoteId: null });
  appQueryClient().clear();
  vault.clear();
  vault.set("note-1", MASKING);
  mocks.noteFacts.mockImplementation(async (filter?: { ids?: readonly string[] }) =>
    [...vault.values()].filter((entry) => !filter?.ids || filter.ids.includes(entry.id)),
  );
  mocks.releaseNoteCaches.mockResolvedValue(undefined);
  mocks.noteLinks.mockResolvedValue([]);
  mocks.setNoteRelatedProject.mockResolvedValue(undefined);
  mocks.claimStarterNote.mockResolvedValue(false);
  mocks.getConfig.mockResolvedValue({
  });
});

afterEach(() => {
  vi.useRealTimers();
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
    expect(mocks.noteFacts).not.toHaveBeenCalled();
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

  it("lists note projects with the facts the backend read from each note", async () => {
    openNotes();
    render(<NotesHost />);
    expect(refreshProjects).toHaveBeenCalledOnce();
    expect(mocks.noteFacts).toHaveBeenCalledOnce();
    await waitFor(() => expect(data().notes[0].agent).toBe("Codex"));
    expect(data().notes).toEqual([
      {
        id: "note-1",
        noteId: "n-note-1",
        title: "Masking ablation",
        project: "Masking paper",
        relatedProjectId: "paper-1",
        updatedAt: 1_700_000_100_000,
        author: "agent",
        agent: "Codex",
        icon: "lucide:atom",
        color: noteColorFor("n-note-1"),
        summary: "Sweep over masking ratios.",
        createdAt: 1_700_000_000_000,
        preview: "Sweep over masking ratios.",
        aliases: [],
        tags: [],
        properties: {},
      },
      {
        id: "note-2",
        title: "Reading list",
        project: enNotes.library.ungrouped,
        updatedAt: 1_700_000_200_000,
        author: "you",
        agent: undefined,
        icon: undefined,
        color: noteColorFor("Reading list"),
        summary: "",
        createdAt: 1_700_000_000_000,
        preview: undefined,
        aliases: undefined,
        tags: undefined,
        properties: undefined,
      },
    ]);
    expect(data().artifacts).toEqual([]);
    expect(data().experiments).toEqual([]);
    expect(data().citations).toBeUndefined();
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

  it("logs and keeps going when note facts cannot be read", async () => {
    const failure = new Error("no facts");
    mocks.noteFacts.mockRejectedValue(failure);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    openNotes();
    render(<NotesHost />);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    await waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("query", failure));
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

  it("hands later note requests to the open workspace and clears each once handled", async () => {
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    expect(props().requestedNoteId).toBeNull();
    act(() => useNotesViewStore.getState().request("note-1"));
    expect(props().requestedNoteId).toBe("note-1");
    act(() => props().onRequestHandled?.());
    expect(useNotesViewStore.getState().requestedNoteId).toBeNull();
    expect(props().requestedNoteId).toBeNull();
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
    const [name, source] = mocks.createNoteProject.mock.calls[0] as [string, string];
    const { id } = readNoteFacts(source);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect([name, source]).toEqual([untitled, newNoteSource(untitled, "", undefined, id)]);
    expect(refreshProjects).toHaveBeenCalledTimes(2);
    expect(mocks.noteFacts).toHaveBeenLastCalledWith({ ids: ["note-3"] });
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
    expect(toastError).toHaveBeenCalledWith(enNotes.failures.createNote);
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

  it("creates the Blocks gallery with a fresh id the first time Notes opens", async () => {
    mocks.claimStarterNote.mockResolvedValue(true);
    mocks.createNoteProject.mockResolvedValue("note-3");
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    await waitFor(() => expect(mocks.createNoteProject).toHaveBeenCalledTimes(1));
    const [name, source, related] = mocks.createNoteProject.mock.calls[0] as [string, string, string | null];
    const created = splitNoteSource(source);
    const expected = splitNoteSource(shipped);
    const fields = (frontMatter: string) => frontMatter.split("\n").filter((line) => !line.startsWith("id: ")).sort();
    expect(name).toBe(enNotes.starter.blocksGallery.title);
    expect(related).toBeNull();
    expect(created.body).toBe(expected.body);
    expect(fields(created.frontMatter)).toEqual(fields(expected.frontMatter));
    expect(readNoteFacts(source).id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(mocks.claimStarterNote).toHaveBeenCalledTimes(1);
  });

  it("leaves the Blocks gallery out once this data folder has had it", async () => {
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    await waitFor(() => expect(mocks.claimStarterNote).toHaveBeenCalledTimes(1));
    expect(mocks.createNoteProject).not.toHaveBeenCalled();
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("waits for the project list before it looks for an existing Blocks gallery", async () => {
    mocks.claimStarterNote.mockResolvedValue(true);
    useFilesStore.setState({ projects: [], projectsLoaded: false });
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    expect(mocks.claimStarterNote).not.toHaveBeenCalled();
    act(() =>
      useFilesStore.setState({
        projects: [...projects, project({ id: "note-3", name: enNotes.starter.blocksGallery.title, kind: "note" })],
        projectsLoaded: true,
      }),
    );
    await waitFor(() => expect(mocks.claimStarterNote).toHaveBeenCalledTimes(1));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
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

describe("note facts after edits", () => {
  it("patches only the saved note and moves the revision when what links and tags see changed", async () => {
    const writeProjectFile = vi.fn(() => Promise.resolve());
    useFilesStore.setState({ writeProjectFile } as never);
    mocks.readFileContent.mockResolvedValue("Old text.\n");
    openNotes();
    render(<NotesHost />);
    await waitFor(() => expect(data().notes.find((note) => note.id === "note-1")?.icon).toBe("lucide:atom"));
    const before = data().revision ?? 0;
    const untouched = data().notes.find((note) => note.id === "note-1");
    vault.set("note-2", facts("note-2", { icon: "lucide:book" }));
    await act(async () => {
      await data().saveNote?.("note-2", "Papers.\n", noteVersion("Old text.\n"));
    });
    await waitFor(() => expect(data().notes.find((note) => note.id === "note-2")?.icon).toBe("lucide:book"));
    expect(mocks.noteFacts).toHaveBeenLastCalledWith({ ids: ["note-2"] });
    expect(data().notes.find((note) => note.id === "note-1")).toBe(untouched);
    expect(data().revision).toBeGreaterThan(before);
    expect(data().changedNotes).toEqual(["note-2"]);
    const after = data().revision;
    mocks.readFileContent.mockResolvedValue("Papers.\n");
    const notes = data().notes;
    await act(async () => {
      await data().saveNote?.("note-2", "Papers.\n\nMore.\n", noteVersion("Papers.\n"));
    });
    await waitFor(() => expect(mocks.noteFacts).toHaveBeenCalledTimes(3));
    expect(data().revision).toBe(after);
    expect(data().notes).toBe(notes);
  });

  it("reads a live note's facts again when its text changes", async () => {
    openNotes();
    render(<NotesHost />);
    await waitFor(() => expect(data().notes.find((note) => note.id === "note-1")?.icon).toBe("lucide:atom"));
    vault.set("note-2", facts("note-2", { icon: "lucide:book" }));
    act(() => data().noteTextChanged?.("note-2", "Live text.\n"));
    await waitFor(() => expect(data().notes.find((note) => note.id === "note-2")?.icon).toBe("lucide:book"));
  });

  it("lets go of the backend's note caches when Notes closes", async () => {
    openNotes();
    const view = render(<NotesHost />);
    await screen.findByTestId("workspace");
    view.unmount();
    expect(mocks.releaseNoteCaches).toHaveBeenCalledOnce();
  });
});

describe("NotesHost papers and projects", () => {
  it("offers the open paper as the place to send a note", async () => {
    useFilesStore.setState({ projectId: "paper-1", activePath: "main.tex" });
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    expect(data().papers).toEqual([{ id: "paper-1", label: "Masking paper" }]);
    act(() => useFilesStore.setState({ activePath: "refs.bib" }));
    expect(data().papers).toEqual([]);
    expect(props().onSendToPaper).toEqual(expect.any(Function));
  });

  it("leaves a shared note's TikZ out of the paper unless it was drawn here", async () => {
    paper.notesRenderTikz.mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"/>');
    paper.writeProjectBytes.mockResolvedValue({});
    useFilesStore.setState({
      projects: [...projects, project({ id: "note-s", name: "Lab log", kind: "note", shared: { server_name: "Lab", role: "editor" } })],
      projectId: "paper-1",
      activePath: "notes/plan.md",
      tree: [],
      refreshTree: vi.fn(() => Promise.resolve(true)),
    });
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    const send = (noteId: string, length: string) =>
      act(async () => {
        props().onSendToPaper?.({ paperId: "paper-1", text: `\`\`\`tikz\n\\draw (0,0) -- (${length},0);\n\`\`\``, noteId });
        await vi.waitFor(() => expect(paper.insertAtCursor).toHaveBeenCalled(), { timeout: 10_000 });
      });
    await send("note-s", "5");
    expect(paper.notesRenderTikz).not.toHaveBeenCalled();
    expect(paper.insertAtCursor.mock.lastCall?.[0]).toContain(enNotes.sendToPaper.leftOut.replace("{{block}}", "TikZ"));
    paper.insertAtCursor.mockClear();
    await send("note-2", "6");
    expect(paper.notesRenderTikz).toHaveBeenCalledOnce();
    expect(paper.insertAtCursor.mock.lastCall?.[0]).toContain("tikz.svg");
  }, 30_000);

  it("tells the user why nothing was sent when the paper is no longer open", async () => {
    useFilesStore.setState({ projectId: "paper-1", activePath: "main.tex" });
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    toastError.mockClear();
    act(() => useFilesStore.setState({ activePath: "refs.bib" }));
    await act(async () => {
      props().onSendToPaper?.({ paperId: "paper-1", text: "# Plan", noteId: "note-1" });
    });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(enNotes.failures.paperNotOpen);
    expect(paper.insertAtCursor).not.toHaveBeenCalled();
  });

  it("starts the library's new project flow and links the note to the project it makes", async () => {
    useSettingsStore.setState({ newProjectOpen: false });
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    act(() => props().onCreateProject?.({ noteId: "note-2", artifactId: null }));
    expect(useSettingsStore.getState().newProjectOpen).toBe(true);
    act(() =>
      useFilesStore.setState({
        projects: [...projects, project({ id: "paper-9", name: "New paper", kind: "latex", main_doc: "main.tex" })],
        projectId: "paper-9",
      }),
    );
    await waitFor(() => expect(mocks.setNoteRelatedProject).toHaveBeenCalledWith("note-2", "paper-9"));
    expect(useHomeViewStore.getState().page).toBe("library");
  });

  it("forgets the note when the new project flow closes without a project", async () => {
    useSettingsStore.setState({ newProjectOpen: false });
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    act(() => props().onCreateProject?.({ noteId: "note-2", artifactId: null }));
    act(() => useSettingsStore.setState({ newProjectOpen: false }));
    act(() =>
      useFilesStore.setState({
        projects: [...projects, project({ id: "paper-8", name: "Opened later", kind: "latex", main_doc: "main.tex" })],
        projectId: "paper-8",
      }),
    );
    await act(async () => {});
    expect(mocks.setNoteRelatedProject).not.toHaveBeenCalled();
  });
});

describe("sending a note to the open paper", () => {
  const CHART = JSON.stringify({ title: "Accuracy", categories: ["A", "B"], series: [{ name: "Run", values: [1, 2] }] });
  const RICH_NOTE = [
    "Masks keep ==the key idea== from [the plan](oleafly://note/plan-1) and [[Reading list|the list]].",
    "",
    "![Loss curve](assets/loss.png)",
    "",
    "```chart",
    CHART,
    "```",
    "",
    "```mermaid",
    "graph TD; A-->B",
    "```",
    "",
    "> [!warning] Careful",
    "> Masks leak.",
    "",
    "```html",
    "<b>Live widget</b>",
    "```",
  ].join("\n");
  const REFERENCE = /!\[[^\]]*\]\(([^)\s]+)|\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}|image\("([^"]+)"/gu;

  function referencedFiles(text: string, from: string): string[] {
    const folder = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
    return [...text.matchAll(REFERENCE)].map((match) => {
      const parts = [...folder.split("/").filter(Boolean)];
      for (const part of (match[1] ?? match[2] ?? match[3]).split("/")) {
        if (part === "..") parts.pop();
        else parts.push(part);
      }
      return parts.join("/");
    });
  }

  beforeEach(() => {
    paper.pandocConvert.mockImplementation(async (request: { text: string }) => ({ text: request.text }));
    paper.readProjectBytes.mockResolvedValue(new Uint8Array([137, 80, 78, 71]).buffer);
    paper.writeProjectBytes.mockResolvedValue({});
    paper.renderMermaidFigure.mockResolvedValue({ svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"/>", pngBase64: "iVBORw0K" });
    paper.svgDocumentToPngBytes.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    mocks.readFileContent.mockResolvedValue("\\documentclass{article}\n\\begin{document}\n\\end{document}\n");
  });

  it.each([
    ["latex", "chapters/results.tex", "main.tex", "main.tex"],
    ["typst", "chapters/results.typ", "main.typ", "chapters/results.typ"],
  ])("sends a %s paper only references to files it copied into the paper", async (target, activePath, mainDoc, from) => {
    useFilesStore.setState({
      projectId: "paper-1",
      activePath,
      mainDoc,
      tree: [{ path: "figures", is_dir: true }, { path: "figures/loss.png", is_dir: false }],
      refreshTree: vi.fn(() => Promise.resolve(true)),
    });
    useHomeViewStore.setState({ page: "notes" });
    await expect(sendTextToPaper("paper-1", RICH_NOTE, "note-1")).resolves.toBe(true);
    expect(useHomeViewStore.getState().page).toBe("library");

    expect(paper.readProjectBytes).toHaveBeenCalledWith("note-1", "assets/loss.png");
    const written = paper.writeProjectBytes.mock.calls.map(([projectId, path]) => {
      expect(projectId).toBe("paper-1");
      return path as string;
    });
    expect(written).not.toContain("figures/loss.png");
    expect(paper.pandocConvert).toHaveBeenCalledWith(expect.objectContaining({ source: "markdown-fragment", target }));
    const sent = paper.insertAtCursor.mock.lastCall?.[0] as string;
    const referenced = referencedFiles(sent, from);
    expect(referenced).toHaveLength(3);
    expect(new Set(referenced)).toEqual(new Set(written));
    expect(sent).toContain("**Careful**");
    expect(sent).toContain("the key idea");
    expect(sent).toContain("the plan");
    expect(sent).toContain("the list");
    expect(sent).toContain(enNotes.sendToPaper.leftOut.replace("{{block}}", "HTML"));
    for (const raw of ["==", "oleafly://", "[[", "[!warning]", "```chart", "```mermaid", "Live widget", '"categories"']) {
      expect(sent).not.toContain(raw);
    }
  });

  it("adds the packages a TikZ block needs to a LaTeX paper's preamble", async () => {
    paper.insertUsepackages.mockResolvedValue(undefined);
    useFilesStore.setState({ projectId: "paper-1", activePath: "chapters/circuit.tex", mainDoc: "main.tex", tree: [] });
    const note = "```circuitikz\n\\usepackage[siunitx]{circuitikz}\n\\draw (0,0) to[R] (2,0);\n```";
    await expect(sendTextToPaper("paper-1", note, "note-1")).resolves.toBe(true);
    expect(paper.insertUsepackages.mock.calls).toEqual([["main.tex", [{ name: "circuitikz", options: "siunitx" }]]]);
    expect(paper.insertAtCursor.mock.lastCall?.[0]).toContain("\\begin{circuitikz}");
    paper.insertUsepackages.mockClear();
    useFilesStore.setState({ activePath: "notes/plan.md" });
    await sendTextToPaper("paper-1", "```tikz\n\\draw (0,0);\n```", "note-1");
    expect(paper.insertUsepackages).not.toHaveBeenCalled();
  });

  it("inserts Markdown as it is and refuses a paper that is not open", async () => {
    useFilesStore.setState({ projectId: "paper-1", activePath: "notes/plan.md" });
    await expect(sendTextToPaper("paper-1", "# Plan", "note-1")).resolves.toBe(true);
    expect(paper.pandocConvert).not.toHaveBeenCalled();
    expect(paper.insertAtCursor).toHaveBeenCalledWith("# Plan");
    await expect(sendTextToPaper("paper-2", "# Plan", "note-1")).resolves.toBe(false);
    expect(paperFormat("main.typ")).toBe("typst");
    expect(paperFormat("refs.bib")).toBeNull();
  });
});

vi.mock("@/features/pandoc-text", () => ({ pandocConvert: paper.pandocConvert }));
