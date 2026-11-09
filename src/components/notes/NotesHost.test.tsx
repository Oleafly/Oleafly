// @vitest-environment jsdom

import type { ProjectInfo } from "@oleafly/backend-port";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { AcpAgentStatus } from "@/lib/acp";
import { normalizeTask, type ResearchTask, type TaskArtifact } from "@/lib/research-tasks";
import { latestRunContext } from "./note-artifacts";
import type { NotesData } from "./notes-data";
import type { NotesWorkspace } from "./NotesWorkspace";

type WorkspaceProps = Parameters<typeof NotesWorkspace>[0];

const mocks = vi.hoisted(() => ({
  noteHeads: vi.fn(),
  noteLinks: vi.fn(),
  setNoteRelatedProject: vi.fn(),
  createNoteProject: vi.fn(),
  readFileContent: vi.fn(),
  getConfig: vi.fn(),
  acpCatalog: vi.fn(),
  logError: vi.fn(),
  listResearchTasks: vi.fn(),
  listenForResearchTaskChanges: vi.fn(),
  onTask: null as null | ((task: ResearchTask) => void),
  canCreate: true,
}));
const paper = vi.hoisted(() => ({ pandocConvert: vi.fn(), insertAtCursor: vi.fn() }));
vi.mock("@/features/tools-ai/pandoc-text", () => ({ pandocConvert: paper.pandocConvert }));
vi.mock("@/components/editor/cm/controller", () => ({ insertAtCursor: paper.insertAtCursor }));
const captured = vi.hoisted(() => ({
  props: null as WorkspaceProps | null,
  data: null as NotesData | null,
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  noteHeads: mocks.noteHeads,
  noteLinks: mocks.noteLinks,
  setNoteRelatedProject: mocks.setNoteRelatedProject,
  createNoteProject: mocks.createNoteProject,
  readFileContent: mocks.readFileContent,
  getConfig: mocks.getConfig,
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
import { newNoteSource, readNoteFacts } from "./note-file";
import { noteVersion } from "./notes-service";
import { NotesHost, paperFormat, sendTextToPaper } from "./NotesHost";

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

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  vi.clearAllMocks();
  resetResearchTasksFlagForTests();
  primeResearchTasksFlag({ research_tasks_enabled: true });
  mocks.canCreate = true;
  captured.props = null;
  captured.data = null;
  refreshProjects = vi.fn(() => Promise.resolve());
  useFilesStore.setState({ projects, refreshProjects });
  useNotesViewStore.setState({ requestedNoteId: null });
  mocks.noteHeads.mockResolvedValue([{ id: "note-1", head: HEAD }]);
  mocks.noteLinks.mockResolvedValue([]);
  mocks.setNoteRelatedProject.mockResolvedValue(undefined);
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

  it("names run agents by model or id when the CLI agent list can't be read", async () => {
    mocks.acpCatalog.mockRejectedValue(new Error("no catalog"));
    mocks.listResearchTasks.mockResolvedValue(TASKS);
    openNotes();
    render(<NotesHost />);
    await waitFor(() => expect(mocks.acpCatalog).toHaveBeenCalledOnce());
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

  it("offers the related project's references and no fixed citation list", async () => {
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    expect(data().citations).toBeUndefined();
    expect(data().projectCitations).toBeTypeOf("function");
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

  it("hands the workspace a way to move notes to the Recycle Bin", async () => {
    openNotes();
    render(<NotesHost />);
    await waitFor(() => expect(captured.data).not.toBeNull());
    expect(data().deleteNote).toEqual(expect.any(Function));
  });
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
        relatedProjectId: "paper-1",
        updatedAt: 1_700_000_100_000,
        author: "agent",
        agent: "Codex",
        icon: "lucide:atom",
        color: readNoteFacts(HEAD).color,
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
        color: readNoteFacts("").color,
        summary: "",
        createdAt: 1_700_000_000_000,
        preview: "",
        aliases: [],
        tags: [],
        properties: {},
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
    expect(mocks.noteHeads).toHaveBeenCalledTimes(1);
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

  it("names agents by model or id until the CLI agent list arrives", async () => {
    mocks.acpCatalog.mockReturnValue(new Promise(() => {}));
    mocks.listResearchTasks.mockResolvedValue(TASKS);
    openNotes();
    render(<NotesHost />);
    await waitFor(() => expect(data().artifacts).toHaveLength(4));
    expect(data().artifacts.map((artifact) => artifact.agent)).toEqual(["sonnet", "gpt-5", "codex", undefined]);
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

describe("note heads after edits", () => {
  const FRESH = "---\ntitle: Reading list\nicon: lucide:book\n---\n\nPapers to read this week.\n";

  it("updates only the saved note's head and moves the revision when its text changed", async () => {
    const writeProjectFile = vi.fn(() => Promise.resolve());
    useFilesStore.setState({ writeProjectFile } as never);
    mocks.readFileContent.mockResolvedValue("Old text.\n");
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    await waitFor(() => expect(data().notes.find((note) => note.id === "note-1")?.icon).toBe("lucide:atom"));
    const before = data().revision ?? 0;
    const untouched = data().notes.find((note) => note.id === "note-1");
    await act(async () => {
      await data().saveNote?.("note-2", FRESH, noteVersion("Old text.\n"));
    });
    expect(writeProjectFile).toHaveBeenCalled();
    expect(mocks.noteHeads).toHaveBeenCalledTimes(1);
    expect(data().notes.find((note) => note.id === "note-2")?.icon).toBe("lucide:book");
    expect(data().notes.find((note) => note.id === "note-1")).toBe(untouched);
    expect(data().revision).toBeGreaterThan(before);
    const after = data().revision;
    mocks.readFileContent.mockResolvedValue(FRESH);
    const notes = data().notes;
    await act(async () => {
      await data().saveNote?.("note-2", FRESH, noteVersion(FRESH));
    });
    expect(data().revision).toBe(after);
    expect(data().notes).toBe(notes);
  });

  it("moves the revision when the notes are read again but not on the first read", async () => {
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    await waitFor(() => expect(data().notes.find((note) => note.id === "note-1")?.icon).toBe("lucide:atom"));
    const first = data().revision;
    expect(first).toBe(0);
    await act(async () => {
      await data().refreshNotes?.();
    });
    await waitFor(() => expect(data().revision).toBe(1));
  });

  it("takes a live note's text as its head without reading the vault again", async () => {
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    await waitFor(() => expect(data().notes.find((note) => note.id === "note-1")?.icon).toBe("lucide:atom"));
    const before = data().revision;
    act(() => data().noteTextChanged?.("note-2", FRESH));
    expect(data().notes.find((note) => note.id === "note-2")?.icon).toBe("lucide:book");
    expect(data().revision).toBe(before);
    expect(mocks.noteHeads).toHaveBeenCalledTimes(1);
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

describe("NotesHost live heads", () => {
  const LIVE = "---\ntitle: Reading list\nicon: lucide:book\n---\n\nLive text.\n";

  it("applies the first live change at once and folds a burst into one later update", async () => {
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    await waitFor(() => expect(data().notes.find((note) => note.id === "note-1")?.icon).toBe("lucide:atom"));
    vi.useFakeTimers();
    try {
      act(() => data().noteTextChanged?.("note-2", LIVE));
      expect(data().notes.find((note) => note.id === "note-2")?.icon).toBe("lucide:book");
      const afterFirst = data();
      act(() => {
        data().noteTextChanged?.("note-2", LIVE.replace("lucide:book", "lucide:atom"));
        data().noteTextChanged?.("note-2", LIVE.replace("lucide:book", "lucide:flask-conical"));
      });
      expect(data()).toBe(afterFirst);
      act(() => vi.advanceTimersByTime(1_000));
      expect(data().notes.find((note) => note.id === "note-2")?.icon).toBe("lucide:flask-conical");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("NotesHost revision after saves", () => {
  it("moves the revision only when links, tags or titles change", async () => {
    const writeProjectFile = vi.fn(() => Promise.resolve());
    useFilesStore.setState({ writeProjectFile } as never);
    const first = "---\ntitle: Reading list\n---\n\nSee [Alpha](oleafly://note/abc).\n";
    mocks.readFileContent.mockResolvedValue("Old.\n");
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    await act(async () => {
      await data().saveNote?.("note-2", first, noteVersion("Old.\n"));
    });
    const linked = data().revision;
    mocks.readFileContent.mockResolvedValue(first);
    const prose = `${first}\nMore words with no links.\n`;
    await act(async () => {
      await data().saveNote?.("note-2", prose, noteVersion(first));
    });
    expect(data().revision).toBe(linked);
    mocks.readFileContent.mockResolvedValue(prose);
    await act(async () => {
      await data().saveNote?.("note-2", `${prose}\nAnd #vision.\n`, noteVersion(prose));
    });
    expect(data().revision).toBeGreaterThan(linked ?? 0);
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

  it("tells the user why nothing was sent when the paper is no longer open", async () => {
    useFilesStore.setState({ projectId: "paper-1", activePath: "main.tex" });
    openNotes();
    render(<NotesHost />);
    await screen.findByTestId("workspace");
    toastError.mockClear();
    act(() => useFilesStore.setState({ activePath: "refs.bib" }));
    await act(async () => {
      props().onSendToPaper?.({ paperId: "paper-1", text: "# Plan" });
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
  it("converts Markdown for a LaTeX or Typst file and inserts it at the cursor", async () => {
    paper.pandocConvert.mockResolvedValue({ text: "\\section{Plan}" });
    useFilesStore.setState({ projectId: "paper-1", activePath: "main.tex" });
    useHomeViewStore.setState({ page: "notes" });
    await expect(sendTextToPaper("paper-1", "# Plan")).resolves.toBe(true);
    expect(paper.pandocConvert).toHaveBeenCalledWith({ source: "markdown", target: "latex", text: "# Plan" });
    expect(paper.insertAtCursor).toHaveBeenCalledWith("\\section{Plan}");
    expect(useHomeViewStore.getState().page).toBe("library");
  });

  it("inserts Markdown as it is and refuses a paper that is not open", async () => {
    useFilesStore.setState({ projectId: "paper-1", activePath: "notes/plan.md" });
    await expect(sendTextToPaper("paper-1", "# Plan")).resolves.toBe(true);
    expect(paper.pandocConvert).not.toHaveBeenCalled();
    expect(paper.insertAtCursor).toHaveBeenCalledWith("# Plan");
    await expect(sendTextToPaper("paper-2", "# Plan")).resolves.toBe(false);
    expect(paperFormat("main.typ")).toBe("typst");
    expect(paperFormat("refs.bib")).toBeNull();
  });
});
