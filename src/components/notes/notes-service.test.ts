import type { ProjectInfo } from "@oleafly/backend-port";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { diskHash } from "@/lib/disk-hash";
import { NoteConflictError } from "./types";

const tauri = vi.hoisted(() => ({
  createNoteProject: vi.fn(),
  readFileContent: vi.fn(),
  renameProjectCmd: vi.fn(),
  unwatchProjectFolder: vi.fn(),
  watchProjectFolder: vi.fn(),
}));
const files = vi.hoisted(() => ({ writeProjectFile: vi.fn() }));
const events = vi.hoisted(() => ({
  handler: null as null | ((event: { payload: unknown }) => void),
  unlisten: vi.fn(),
}));

vi.mock("@/lib/tauri", () => tauri);
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => files } }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name: string, handler: (event: { payload: unknown }) => void) => {
    events.handler = handler;
    return Promise.resolve(events.unlisten);
  }),
}));

const { createNotesService, noteItems } = await import("./notes-service");

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
    const heads = new Map([["note-1", "---\ntitle: Masking\nicon: 🧪\nagent: Codex\n---\n\nRun 3 reached 64.1%.\n"]]);
    expect(noteItems(PROJECTS, heads, "Notes")).toEqual([
      {
        id: "note-1",
        title: "Masking",
        project: "SSL paper",
        updatedAt: 1_700_000_000_000,
        author: "agent",
        agent: "Codex",
        icon: "🧪",
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
        summary: "",
      },
    ]);
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

  it("creates an untitled note project and renames notes", async () => {
    tauri.createNoteProject.mockResolvedValue("new-id");
    tauri.renameProjectCmd.mockResolvedValue({});
    const { deps, notes } = service();
    await expect(notes.createNote?.()).resolves.toBe("new-id");
    expect(tauri.createNoteProject).toHaveBeenCalledWith("Untitled", "---\ntitle: Untitled\n---\n\n");
    await notes.renameNote?.("note-1", "Renamed");
    expect(tauri.renameProjectCmd).toHaveBeenCalledWith("note-1", "Renamed");
    expect(deps.refreshProjects).toHaveBeenCalledTimes(2);
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
});
