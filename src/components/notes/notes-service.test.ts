import type { ProjectInfo } from "@oleafly/backend-port";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { diskHash } from "@/lib/disk-hash";
import { newNoteSource, readNoteFacts } from "./note-file";
import { NoteConflictError } from "./types";

const tauri = vi.hoisted(() => ({
  createNoteProject: vi.fn(),
  readFileContent: vi.fn(),
  recycleProject: vi.fn(),
  renameProjectCmd: vi.fn(),
  setNoteRelatedProject: vi.fn(),
  unwatchProjectFolder: vi.fn(),
  watchProjectFolder: vi.fn(),
}));
const files = vi.hoisted(() => ({ writeProjectFile: vi.fn() }));
const research = vi.hoisted(() => ({
  previewResearchTaskArtifact: vi.fn(),
  copyResearchTaskArtifactToNote: vi.fn(),
}));
const assets = vi.hoisted(() => ({ loadAssetThumbnail: vi.fn() }));
const events = vi.hoisted(() => ({
  handler: null as null | ((event: { payload: unknown }) => void),
  unlisten: vi.fn(),
}));

vi.mock("@/lib/tauri", () => tauri);
vi.mock("@/lib/research-tasks", () => research);
vi.mock("@/components/editor/cm/hover-asset", () => assets);
const agent = vi.hoisted(() => ({ runNoteAgent: vi.fn() }));
vi.mock("./note-agent", () => agent);
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => files } }));
const log = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => log);
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name: string, handler: (event: { payload: unknown }) => void) => {
    events.handler = handler;
    return Promise.resolve(events.unlisten);
  }),
}));

const { createNotesService, noteItems, relatedProjectChoices } = await import("./notes-service");

function project(overrides: Partial<ProjectInfo>): ProjectInfo {
  return {
    id: "note-1",
    name: "Masking",
    main_doc: "note.md",
    kind: "note",
    created_at: 1,
    updated_at: 1_700_000_000,
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
    ...overrides,
  };
}

const PROJECTS = [
  project({ related_project: "paper" }),
  project({ id: "plain", name: "Plain note" }),
  project({ id: "paper", name: "SSL paper", kind: "document", main_doc: "main.tex" }),
];

function service(projects = PROJECTS) {
  const deps = {
    projects: () => projects,
    refreshProjects: vi.fn(() => Promise.resolve()),
    refreshHeads: vi.fn(),
    untitled: "Untitled",
    missing: "This note couldn't be opened.",
  };
  return { deps, notes: createNotesService(deps) };
}

beforeEach(() => {
  vi.clearAllMocks();
  events.handler = null;
});

describe("notes from the library", () => {
  it("lists only note projects, grouped under the project they belong to", () => {
    const heads = new Map([
      ["note-1", "---\ntitle: Masking\nicon: 🧪\nagent: Codex\nkind: note\nid: 1f2e3d4c-5b6a-4987-8654-3210fedcba98\n---\n\nRun 3 reached 64.1%.\n"],
    ]);
    expect(noteItems(PROJECTS, heads, "Notes")).toEqual([
      {
        id: "note-1",
        title: "Masking",
        project: "SSL paper",
        relatedProjectId: "paper",
        updatedAt: 1_700_000_000_000,
        author: "agent",
        agent: "Codex",
        icon: "🧪",
        color: readNoteFacts(heads.get("note-1") ?? "").color,
        summary: "Run 3 reached 64.1%.",
      },
      {
        id: "plain",
        title: "Plain note",
        project: "Notes",
        updatedAt: 1_700_000_000_000,
        author: "you",
        agent: undefined,
        icon: undefined,
        color: readNoteFacts("").color,
        summary: "",
      },
    ]);
  });

  it("files a note whose related project is gone under the ungrouped heading", () => {
    const notes = noteItems([project({ id: "orphan", name: "Orphan", related_project: "deleted" })], new Map(), "Notes");
    expect(notes).toHaveLength(1);
    expect(notes[0].project).toBe("Notes");
    expect(notes[0]).toHaveProperty("relatedProjectId", undefined);
  });

  it("loads a note with the hash the backend checks on save", async () => {
    tauri.readFileContent.mockResolvedValue("hello\n");
    const { notes } = service();
    await expect(notes.loadNote("note-1")).resolves.toEqual({ text: "hello\n", version: diskHash("hello\n") });
    expect(tauri.readFileContent).toHaveBeenCalledWith("note-1", "note.md");
  });

  it("refuses a note that is not in the library", async () => {
    const { notes } = service();
    await expect(notes.loadNote("gone")).rejects.toThrow("This note couldn't be opened.");
  });

  it("saves through the files store when the file is still the version it loaded", async () => {
    tauri.readFileContent.mockResolvedValue("old\n");
    files.writeProjectFile.mockResolvedValue(undefined);
    const { deps, notes } = service();
    await expect(notes.saveNote("note-1", "new\n", diskHash("old\n"))).resolves.toEqual({
      text: "new\n",
      version: diskHash("new\n"),
    });
    expect(files.writeProjectFile).toHaveBeenCalledWith("note-1", "note.md", "new\n");
    expect(deps.refreshHeads).toHaveBeenCalled();
  });

  it("refuses to write over a change made on disk and hands back what is there", async () => {
    tauri.readFileContent.mockResolvedValue("from the agent\n");
    const { notes } = service();
    const error = await notes.saveNote("note-1", "mine\n", diskHash("old\n")).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NoteConflictError);
    expect((error as NoteConflictError).disk).toEqual({ text: "from the agent\n", version: diskHash("from the agent\n") });
    expect(files.writeProjectFile).not.toHaveBeenCalled();
  });

  it("gives each new note its own id", async () => {
    tauri.createNoteProject.mockResolvedValue("new-id");
    const { notes } = service();
    await notes.createNote?.();
    await notes.createNote?.();
    const ids = tauri.createNoteProject.mock.calls.map(([, source]) => /\nid: ([^\n]+)\n/u.exec(source as string)?.[1]);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("ignores line endings when it checks the version and writes LF", async () => {
    tauri.readFileContent.mockResolvedValue("a\r\nb\r\n");
    files.writeProjectFile.mockResolvedValue(undefined);
    const { notes } = service();
    const loaded = await notes.loadNote("note-1");
    expect(loaded.version).toBe(diskHash("a\nb\n"));
    await expect(notes.saveNote("note-1", "a\r\nc\n", loaded.version)).resolves.toEqual({
      text: "a\nc\n",
      version: diskHash("a\nc\n"),
    });
    expect(files.writeProjectFile).toHaveBeenCalledWith("note-1", "note.md", "a\nc\n");
  });

  it("passes other save failures through", async () => {
    tauri.readFileContent.mockResolvedValue("old\n");
    files.writeProjectFile.mockRejectedValue(new Error("disk full"));
    const { notes } = service();
    await expect(notes.saveNote("note-1", "x", diskHash("old\n"))).rejects.toThrow("disk full");
  });

  it("creates an untitled note project that names its kind and id, and renames notes", async () => {
    const id = "c0ffee00-1234-4abc-8def-0123456789ab";
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
    tauri.createNoteProject.mockResolvedValue("new-id");
    tauri.renameProjectCmd.mockResolvedValue({});
    const { deps, notes } = service();
    await expect(notes.createNote?.()).resolves.toBe("new-id");
    expect(tauri.createNoteProject).toHaveBeenCalledWith("Untitled", newNoteSource("Untitled", "", undefined, id));
    const source = tauri.createNoteProject.mock.calls[0][1] as string;
    expect(source).toMatch(/^---\ntitle: Untitled\n/u);
    expect(source).toContain("\nkind: note\n");
    expect(source).toContain(`\nid: ${id}\n`);
    expect(uuid).toHaveBeenCalledOnce();
    uuid.mockRestore();
    await notes.renameNote?.("note-1", "Renamed");
    expect(tauri.renameProjectCmd).toHaveBeenCalledWith("note-1", "Renamed");
    expect(deps.refreshProjects).toHaveBeenCalledTimes(2);
  });

  it("moves a note to the Recycle Bin and reloads the library and the note heads", async () => {
    tauri.recycleProject.mockResolvedValue(undefined);
    const { deps, notes } = service();
    await notes.deleteNote?.("plain");
    expect(tauri.recycleProject).toHaveBeenCalledExactlyOnceWith("plain");
    expect(deps.refreshProjects).toHaveBeenCalledOnce();
    expect(deps.refreshHeads).toHaveBeenCalledOnce();
  });

  it("reloads nothing when a note can't be moved to the Recycle Bin", async () => {
    tauri.recycleProject.mockRejectedValue(new Error("not recyclable"));
    const { deps, notes } = service();
    await expect(notes.deleteNote?.("plain")).rejects.toThrow("not recyclable");
    expect(deps.refreshProjects).not.toHaveBeenCalled();
    expect(deps.refreshHeads).not.toHaveBeenCalled();
  });

  it("reports changes to the note file and nothing else, then stops watching", async () => {
    tauri.watchProjectFolder.mockResolvedValue(7);
    tauri.unwatchProjectFolder.mockResolvedValue(true);
    const { notes } = service();
    const onChange = vi.fn();
    const stop = notes.watchNote?.("note-1", onChange);
    expect(tauri.watchProjectFolder).toHaveBeenCalledWith("note-1");
    events.handler?.({ payload: { projectId: "other", paths: ["note.md"], rescan: false } });
    events.handler?.({ payload: { projectId: "note-1", paths: ["assets/figure.svg"], rescan: false } });
    expect(onChange).not.toHaveBeenCalled();
    events.handler?.({ payload: { projectId: "note-1", paths: ["note.md"], rescan: false } });
    events.handler?.({ payload: { projectId: "note-1", paths: [], rescan: true } });
    expect(onChange).toHaveBeenCalledTimes(2);
    stop?.();
    await vi.waitFor(() => expect(tauri.unwatchProjectFolder).toHaveBeenCalledWith("note-1", 7));
    expect(events.unlisten).toHaveBeenCalled();
    events.handler?.({ payload: { projectId: "note-1", paths: ["note.md"], rescan: false } });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("logs a folder watch that fails to start and has nothing to stop later", async () => {
    const failure = new Error("watch refused");
    tauri.watchProjectFolder.mockRejectedValue(failure);
    const { notes } = service();
    const onChange = vi.fn();
    const stop = notes.watchNote?.("note-1", onChange);
    await vi.waitFor(() => expect(log.logError).toHaveBeenCalledWith("watch note folder", failure));
    events.handler?.({ payload: { projectId: "note-1", paths: ["notes/note.md"], rescan: false } });
    expect(onChange).toHaveBeenCalledOnce();
    stop?.();
    await vi.waitFor(() => expect(events.unlisten).toHaveBeenCalled());
    await Promise.resolve();
    expect(tauri.unwatchProjectFolder).not.toHaveBeenCalled();
  });

  it("logs a folder watch that fails to stop", async () => {
    const failure = new Error("unwatch refused");
    tauri.watchProjectFolder.mockResolvedValue(3);
    tauri.unwatchProjectFolder.mockRejectedValue(failure);
    const { notes } = service();
    const onChange = vi.fn();
    const stop = notes.watchNote?.("note-1", onChange);
    events.handler?.({ payload: { projectId: "note-1", paths: ["notes\\note.md"], rescan: false } });
    expect(onChange).toHaveBeenCalledOnce();
    stop?.();
    await vi.waitFor(() => expect(log.logError).toHaveBeenCalledWith("stop watching note folder", failure));
  });

  it("asks the chosen agent for edits and passes the stop signal along", async () => {
    agent.runNoteAgent.mockResolvedValue([{ find: "a", replace: "b" }]);
    const { notes } = service();
    const choice = { providerId: "acp:claude", modelId: "default", label: "Claude Code" };
    const request = { noteId: "note-1", agent: choice, actionId: null, prompt: "Tighten", quote: null, source: "a" };
    const signal = new AbortController().signal;
    await expect(notes.proposeEdits(request, signal)).resolves.toEqual([{ find: "a", replace: "b" }]);
    expect(agent.runNoteAgent).toHaveBeenCalledWith(choice, request, signal);
  });
});

describe("note artifacts and related projects", () => {
  const artifact = {
    id: "task-1\nresults/table.csv",
    taskId: "task-1",
    path: "results/table.csv",
    title: "Results",
    kind: "data" as const,
    projectId: "paper",
    project: "SSL paper",
    updatedAt: 1,
    chat: "Sweep",
    summary: "",
  };

  it("links a note to a project, or unlinks it, and reloads the library", async () => {
    tauri.setNoteRelatedProject.mockResolvedValue(undefined);
    const { deps, notes } = service();
    await notes.setRelatedProject?.("note-1", "paper");
    expect(tauri.setNoteRelatedProject).toHaveBeenCalledWith("note-1", "paper");
    await notes.setRelatedProject?.("note-1", null);
    expect(tauri.setNoteRelatedProject).toHaveBeenLastCalledWith("note-1", null);
    expect(deps.refreshProjects).toHaveBeenCalledTimes(2);
  });

  it("does not reload the library when linking fails", async () => {
    tauri.setNoteRelatedProject.mockRejectedValue(new Error("no such project"));
    const { deps, notes } = service();
    await expect(notes.setRelatedProject?.("note-1", "gone")).rejects.toThrow("no such project");
    expect(deps.refreshProjects).not.toHaveBeenCalled();
  });

  it("previews a task file the way the artifact panel shows it", async () => {
    research.previewResearchTaskArtifact.mockResolvedValue({
      artifact: { path: artifact.path, label: "Results", mediaType: "text/csv" },
      content: {
        exists: true,
        text: "a,b\n1,2\n",
        base64: null,
        mediaType: "text/csv",
        binary: false,
        truncated: false,
        size: 8,
        sha256: null,
      },
    });
    const { notes } = service();
    await expect(notes.previewArtifact?.(artifact)).resolves.toEqual({
      type: "table",
      rows: [
        ["a", "b"],
        ["1", "2"],
      ],
      truncated: false,
    });
    expect(research.previewResearchTaskArtifact).toHaveBeenCalledWith("task-1", "results/table.csv");
  });

  it("copies a task file into the note and hands back its path", async () => {
    research.copyResearchTaskArtifactToNote.mockResolvedValue({ path: "assets/table.csv", reused: false });
    const { notes } = service();
    await expect(notes.copyArtifact?.("note-1", artifact)).resolves.toBe("assets/table.csv");
    expect(research.copyResearchTaskArtifactToNote).toHaveBeenCalledWith("task-1", "results/table.csv", "note-1");
  });

  it("resolves note images through the editor's asset thumbnails", async () => {
    assets.loadAssetThumbnail.mockResolvedValue("data:image/png;base64,AAAA");
    const { notes } = service();
    await expect(notes.resolveAsset?.("note-1", "assets/loss.png")).resolves.toBe("data:image/png;base64,AAAA");
    expect(assets.loadAssetThumbnail).toHaveBeenCalledWith("note-1", "assets/loss.png");
  });

  it("offers the projects a note can relate to, newest first", () => {
    const choices = relatedProjectChoices([
      project({ id: "old", name: "Old paper", kind: "latex", updated_at: 100 }),
      project({ id: "a-note", name: "A note", kind: "note", updated_at: 900 }),
      project({ id: "broken", name: "Broken", kind: "typst", updated_at: 800, recovery_pending: true }),
      project({ id: "new", name: "New paper", kind: "typst", updated_at: 500 }),
      project({ id: "plain", name: "Plain", kind: "markdown", updated_at: 300 }),
    ]);
    expect(choices).toEqual([
      { id: "new", name: "New paper" },
      { id: "plain", name: "Plain" },
      { id: "old", name: "Old paper" },
    ]);
  });

  it("offers nothing when the library holds only notes", () => {
    expect(relatedProjectChoices([project({})])).toEqual([]);
  });
});
