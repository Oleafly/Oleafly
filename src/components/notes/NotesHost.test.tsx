// @vitest-environment jsdom

import type { ProjectInfo } from "@oleafly/backend-port";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { AcpAgentStatus } from "@/lib/acp";
import { appQueryClient } from "@/lib/query";
import { normalizeTask, type ResearchTask, type TaskArtifact } from "@/lib/research-tasks";
import type { NoteFacts } from "@/lib/tauri";
import { latestRunContext } from "./note-artifacts";
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
  acpCatalog: vi.fn(),
  logError: vi.fn(),
  listResearchTasks: vi.fn(),
  listenForResearchTaskChanges: vi.fn(),
  onTask: null as null | ((task: ResearchTask) => void),
  canCreate: true,
}));
const paper = vi.hoisted(() => ({
  pandocConvert: vi.fn(),
  insertAtCursor: vi.fn(),
  readProjectBytes: vi.fn(),
  writeProjectBytes: vi.fn(),
  renderMermaidFigure: vi.fn(),
  svgDocumentToPngBytes: vi.fn(),
  insertUsepackage: vi.fn(),
  notesRenderTikz: vi.fn(),
}));
vi.mock("@/features/tools-ai/pandoc-text", () => ({ pandocConvert: paper.pandocConvert }));
vi.mock("@/components/editor/cm/controller", () => ({ insertAtCursor: paper.insertAtCursor }));
vi.mock("@/components/diagram/mermaid-render", () => ({ renderMermaidFigure: paper.renderMermaidFigure }));
vi.mock("@/features/equation-export", () => ({ svgDocumentToPngBytes: paper.svgDocumentToPngBytes }));
vi.mock("@/components/packages/latex-document", () => ({ insertUsepackage: paper.insertUsepackage }));
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
}));
vi.mock("@/lib/acp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/acp")>()),
  acpCatalog: mocks.acpCatalog,
}));
vi.mock("@/lib/research-tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/research-tasks")>()),
  listResearchTasks: mocks.listResearchTasks,
  listenForResearchTaskChanges: mocks.listenForResearchTaskChanges,
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
import { primeResearchTasksFlag, resetResearchTasksFlagForTests } from "@/store/research-tasks-flag";
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
  resetResearchTasksFlagForTests();
  primeResearchTasksFlag({ research_tasks_enabled: true });
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
    ai_provider: "anthropic",
    ai_model: "claude-sonnet",
    ai_keys: { anthropic: "key" },
    ai_custom_providers: [],
    ai_provider_models: {},
  });
  mocks.acpCatalog.mockResolvedValue([]);
  mocks.onTask = null;
  mocks.listResearchTasks.mockResolvedValue([]);
  mocks.listenForResearchTaskChanges.mockImplementation((onTask: (task: ResearchTask) => void) => {
    mocks.onTask = onTask;
    return Promise.resolve(() => {});
  });
});

afterEach(() => {
  vi.useRealTimers();
  useFilesStore.setState(saved.files, true);
  useHomeViewStore.setState(saved.home, true);
  useNotesViewStore.setState(saved.notesView, true);
  useSettingsStore.setState(saved.settings, true);
});

const ISOLATION = {
  kind: "staged_project" as const,
  executionRoot: "/tmp/run",
  sourceRevision: "rev",
  baselineHash: "hash",
  fileCount: 1,
  createdAt: 1,
};

function researchTask(
  id: string,
  overrides: Partial<ResearchTask> & { artifacts?: TaskArtifact[]; summary?: string } = {},
): ResearchTask {
  const { artifacts = [], summary = "", ...rest } = overrides;
  return normalizeTask({
    id,
    projectId: "paper-1",
    status: "completed",
    title: id,
    prompt: `Run ${id}`,
    isolation: ISOLATION,
    result: { summary, changedFiles: [], artifacts, nativeSessionId: null, inputTokens: null, outputTokens: null },
    ...rest,
  });
}

function catalogAgent(id: string, name: string): AcpAgentStatus {
  return { definition: { id, name }, installed: false } as unknown as AcpAgentStatus;
}

const TASKS = [
  researchTask("by-claude", {
    agentId: "claude",
    modelId: "sonnet",
    title: "Loss sweep",
    finishedAt: 3_000,
    summary: "Loss fell.",
    artifacts: [{ path: "figs/loss.png", label: "Loss curve", mediaType: "image/png" }],
  }),
  researchTask("by-model", {
    agentId: "unknown",
    modelId: "gpt-5",
    finishedAt: 2_000,
    artifacts: [{ path: "results.csv", label: "Results", mediaType: "text/csv" }],
  }),
  researchTask("by-agent", {
    agentId: "codex",
    modelId: "",
    finishedAt: 1_000,
    artifacts: [{ path: "report.md", label: "Report", mediaType: null }],
  }),
  researchTask("by-nobody", {
    agentId: "",
    modelId: "",
    finishedAt: 500,
    artifacts: [{ path: "notes.txt", label: "Notes", mediaType: null }],
  }),
];

describe("NotesHost agents", () => {
  it("reads neither the AI settings nor the CLI agent list when there are no research runs", async () => {
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.acpCatalog).not.toHaveBeenCalled();
    expect(data()).not.toHaveProperty("agents");
    expect(data()).not.toHaveProperty("preferredAgent");
    expect(data()).not.toHaveProperty("openAgentSettings");
  });

  it.each([
    ["can't be read", () => Promise.reject(new Error("no catalog"))],
    ["has not arrived yet", () => new Promise<AcpAgentStatus[]>(() => {})],
  ])("names run agents by model or id while the CLI agent list %s", async (_name, catalog) => {
    mocks.acpCatalog.mockImplementation(catalog);
    mocks.listResearchTasks.mockResolvedValue(TASKS);
    openNotes();
    render(<NotesHost />);
    await waitFor(() => expect(data().artifacts).toHaveLength(4));
    expect(mocks.acpCatalog).toHaveBeenCalledOnce();
    expect(data().artifacts.map((artifact) => artifact.agent)).toEqual(["sonnet", "gpt-5", "codex", undefined]);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("ignores a CLI agent list that arrives after Notes has closed", async () => {
    let resolve: (value: AcpAgentStatus[]) => void = () => {};
    mocks.acpCatalog.mockReturnValue(new Promise((done) => (resolve = done)));
    mocks.listResearchTasks.mockResolvedValue(TASKS);
    openNotes();
    const view = render(<NotesHost />);
    await waitFor(() => expect(mocks.acpCatalog).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => resolve([catalogAgent("claude", "Claude Code")]));
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("opens Settings at the Notes tab of Appearance", async () => {
    useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "shortcuts" });
    openNotes();
    render(<NotesHost />);
    await waitFor(() => expect(captured.data).not.toBeNull());
    act(() => data().openSettings?.());
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
    expect(useSettingsStore.getState().settingsInitialSection).toBe("appearance");
    expect(useSettingsStore.getState().settingsInitialAppearanceTab).toBe("notes");
  });
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

describe("NotesHost research tasks", () => {
  it("builds artifacts, experiments, project choices and the latest run from the related project's tasks", async () => {
    mocks.acpCatalog.mockResolvedValue([catalogAgent("claude", "Claude Code")]);
    mocks.listResearchTasks.mockResolvedValue(TASKS);
    openNotes();
    render(<NotesHost />);
    await waitFor(() => expect(data().artifacts[0]?.agent).toBe("Claude Code"));
    expect(mocks.listResearchTasks.mock.calls).toEqual([["paper-1"]]);
    expect(data().artifacts.map(({ taskId, path, title, kind, project, agent, updatedAt }) => ({ taskId, path, title, kind, project, agent, updatedAt }))).toEqual([
      { taskId: "by-claude", path: "figs/loss.png", title: "Loss curve", kind: "figure", project: "Masking paper", agent: "Claude Code", updatedAt: 3_000 },
      { taskId: "by-model", path: "results.csv", title: "Results", kind: "data", project: "Masking paper", agent: "gpt-5", updatedAt: 2_000 },
      { taskId: "by-agent", path: "report.md", title: "Report", kind: "report", project: "Masking paper", agent: "codex", updatedAt: 1_000 },
      { taskId: "by-nobody", path: "notes.txt", title: "Notes", kind: "report", project: "Masking paper", agent: undefined, updatedAt: 500 },
    ]);
    expect(data().experiments).toEqual([
      { projectId: "paper-1", project: "Masking paper", tasks: 4, figures: 1, reports: 3, updatedAt: 3_000, noteId: "note-1" },
    ]);
    expect(data().projects).toEqual([{ id: "paper-1", name: "Masking paper" }]);
    const latest = data().latestRun?.("note-1");
    expect(latest).toBe(latestRunContext(TASKS));
    expect(latest).toContain("Task: Loss sweep");
    expect(latest).toContain("Agent: claude (sonnet)");
    expect(data().latestRun?.("note-2")).toBeNull();
    expect(data().latestRun?.("gone")).toBeNull();
  });

  it("merges the files of every related project, newest first", async () => {
    useFilesStore.setState({
      projects: [
        ...projects,
        project({ id: "paper-2", name: "Thesis", kind: "typst", main_doc: "main.typ", updated_at: 1_700_000_300 }),
        project({ id: "note-3", name: "Thesis notes", kind: "note", related_project: "paper-2" }),
      ],
    });
    mocks.listResearchTasks.mockImplementation((projectId: string) =>
      Promise.resolve(
        projectId === "paper-1"
          ? TASKS.slice(0, 2)
          : [researchTask("thesis-run", { projectId: "paper-2", finishedAt: 2_500, artifacts: [{ path: "fig.svg", label: "", mediaType: null }] })],
      ),
    );
    openNotes();
    render(<NotesHost />);
    await waitFor(() => expect(data().artifacts).toHaveLength(3));
    expect(mocks.listResearchTasks.mock.calls).toEqual([["paper-1"], ["paper-2"]]);
    expect(data().artifacts.map((artifact) => [artifact.taskId, artifact.project, artifact.title])).toEqual([
      ["by-claude", "Masking paper", "Loss curve"],
      ["thesis-run", "Thesis", "fig.svg"],
      ["by-model", "Masking paper", "Results"],
    ]);
    expect(data().experiments.map((experiment) => [experiment.projectId, experiment.noteId])).toEqual([
      ["paper-1", "note-1"],
      ["paper-2", "note-3"],
    ]);
    expect(data().projects).toEqual([
      { id: "paper-2", name: "Thesis" },
      { id: "paper-1", name: "Masking paper" },
    ]);
  });

  it("has no latest run while the related project's tasks are still loading", async () => {
    mocks.listResearchTasks.mockReturnValue(new Promise(() => {}));
    openNotes();
    render(<NotesHost />);
    await waitFor(() => expect(mocks.listResearchTasks).toHaveBeenCalledWith("paper-1"));
    expect(data().latestRun?.("note-1")).toBeNull();
    expect(data().artifacts).toEqual([]);
  });

  it("labels files by project id while a removed project's tasks are replaced", async () => {
    mocks.listResearchTasks.mockResolvedValue(TASKS.slice(0, 1));
    openNotes();
    render(<NotesHost />);
    await waitFor(() => expect(data().artifacts).toHaveLength(1));
    mocks.listResearchTasks.mockReturnValue(new Promise(() => {}));
    act(() =>
      useFilesStore.setState({
        projects: [
          project({ id: "paper-2", name: "Thesis", kind: "typst", main_doc: "main.typ" }),
          project({ id: "note-1", name: "Masking ablation", kind: "note", related_project: "paper-2" }),
        ],
      }),
    );
    await waitFor(() => expect(mocks.listResearchTasks).toHaveBeenCalledWith("paper-2"));
    expect(data().artifacts.map((artifact) => artifact.project)).toEqual(["paper-1"]);
    expect(data().experiments).toEqual([]);
  });

  it("shows a task that changes while Notes is open", async () => {
    mocks.listResearchTasks.mockResolvedValue(TASKS.slice(1, 2));
    openNotes();
    render(<NotesHost />);
    await waitFor(() => expect(data().artifacts).toHaveLength(1));
    await waitFor(() => expect(mocks.onTask).not.toBeNull());
    act(() => mocks.onTask?.(TASKS[0]));
    expect(data().artifacts.map((artifact) => artifact.taskId)).toEqual(["by-claude", "by-model"]);
    expect(data().latestRun?.("note-1")).toContain("Task: Loss sweep");
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

describe("NotesHost research tasks switch", () => {
  it("shows no artifacts and reads no tasks while Research tasks is off", async () => {
    resetResearchTasksFlagForTests();
    primeResearchTasksFlag({ research_tasks_enabled: false });
    mocks.listResearchTasks.mockResolvedValue(TASKS);
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    await act(async () => {});
    expect(mocks.listResearchTasks).not.toHaveBeenCalled();
    expect(data().researchTasks).toBe(false);
    expect(data().artifacts).toEqual([]);
    expect(data().experiments).toEqual([]);
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
    paper.insertUsepackage.mockResolvedValue("file");
    useFilesStore.setState({ projectId: "paper-1", activePath: "chapters/circuit.tex", mainDoc: "main.tex", tree: [] });
    const note = "```circuitikz\n\\usepackage[siunitx]{circuitikz}\n\\draw (0,0) to[R] (2,0);\n```";
    await expect(sendTextToPaper("paper-1", note, "note-1")).resolves.toBe(true);
    expect(paper.insertUsepackage.mock.calls).toEqual([["main.tex", "circuitikz", "siunitx"]]);
    expect(paper.insertAtCursor.mock.lastCall?.[0]).toContain("\\begin{circuitikz}");
    paper.insertUsepackage.mockClear();
    useFilesStore.setState({ activePath: "notes/plan.md" });
    await sendTextToPaper("paper-1", "```tikz\n\\draw (0,0);\n```", "note-1");
    expect(paper.insertUsepackage).not.toHaveBeenCalled();
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
