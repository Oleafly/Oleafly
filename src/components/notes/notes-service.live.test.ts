import type { ProjectInfo } from "@oleafly/backend-port";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { diskHash } from "@/lib/disk-hash";
import { NoteConflictError } from "./types";

const tauri = vi.hoisted(() => ({
  readFileContent: vi.fn(),
  renameProjectCmd: vi.fn(),
}));
const files = vi.hoisted(() => ({ writeProjectFile: vi.fn() }));
const gate = vi.hoisted(() => ({ live: false }));
const log = vi.hoisted(() => ({ logError: vi.fn() }));

vi.mock("@/lib/tauri", () => tauri);
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => files } }));
vi.mock("@/lib/log", () => log);
vi.mock("@/lib/shared-document-writes", () => ({ sharedDocumentLive: () => gate.live }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock("@/lib/native-file-dialog", () => ({}));
vi.mock("@/lib/research-tasks", () => ({}));
vi.mock("@/components/editor/cm/hover-asset", () => ({}));

const { createNoteItems, createNotesService } = await import("./notes-service");
const { noteEditorOpen, registerNoteEditor } = await import("@/lib/open-note-editors");
const { noteEditorHandle } = await import("@/lib/tests/open-note-editor-fixtures");

function project(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id: "note-1",
    name: "Bench notes",
    main_doc: "note.md",
    kind: "note",
    created_at: 1,
    updated_at: 2,
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
    ...overrides,
  };
}

function service(projects = [project()]) {
  const deps = {
    projects: () => projects,
    refreshProjects: vi.fn(async () => undefined),
    untitled: "Untitled",
    missing: "Missing",
  };
  return { deps, notes: createNotesService(deps) };
}

beforeEach(() => {
  vi.clearAllMocks();
  gate.live = false;
  files.writeProjectFile.mockResolvedValue(undefined);
  tauri.renameProjectCmd.mockResolvedValue({});
});

describe("notes service for shared notes", () => {
  it("marks shared notes", () => {
    const items = createNoteItems()([project({ shared: { server_name: "Lab", role: "editor" } }), project({ id: "plain" })], [], "No project");
    expect(items.map((item) => item.shared)).toEqual([true, undefined]);
  });

  it("merges a save onto the shared text when the note is live and a base is given", async () => {
    gate.live = true;
    const { notes } = service();
    await expect(notes.saveNote("note-1", "mine\r\n", "stale", "base\r\n")).resolves.toEqual({
      text: "mine\n",
      version: diskHash("mine\n"),
    });
    expect(tauri.readFileContent).not.toHaveBeenCalled();
    expect(files.writeProjectFile).toHaveBeenCalledWith("note-1", "note.md", "mine\n", { base: "base\n", closedProject: true });
  });

  it("checks the disk version when the note is not live, even with a base", async () => {
    tauri.readFileContent.mockResolvedValue("disk\n");
    const { notes } = service();
    await expect(notes.saveNote("note-1", "mine\n", "stale", "base\n")).rejects.toBeInstanceOf(NoteConflictError);
    await expect(notes.saveNote("note-1", "mine\n", diskHash("disk\n"), "base\n")).resolves.toMatchObject({ text: "mine\n" });
    expect(tauri.readFileContent).toHaveBeenCalledOnce();
    expect(files.writeProjectFile).toHaveBeenCalledWith("note-1", "note.md", "mine\n", {
      closedProject: true,
      crlf: false,
      expectedHash: diskHash("disk\n"),
    });
  });

  it.each([
    ["LF", "\n", false],
    ["CRLF", "\r\n", true],
  ])("writes the new title into a closed note's front matter and keeps its %s line endings", async (_name, eol, crlf) => {
    const disk = ["---", "title: Bench notes", "kind: note", "---", "", "Body.", ""].join(eol);
    tauri.readFileContent.mockResolvedValue(disk);
    const { deps, notes } = service();
    await notes.renameNote?.("note-1", "Bench log");
    expect(tauri.renameProjectCmd).toHaveBeenCalledWith("note-1", "Bench log");
    expect(files.writeProjectFile).toHaveBeenCalledWith("note-1", "note.md", "---\ntitle: Bench log\nkind: note\n---\n\nBody.\n", {
      closedProject: true,
      crlf,
      expectedHash: diskHash(disk),
    });
    expect(deps.refreshProjects).toHaveBeenCalledOnce();
  });

  it("leaves the file alone when the title already matches", async () => {
    tauri.readFileContent.mockResolvedValue("---\ntitle: Same\n---\n");
    const { notes } = service();
    await notes.renameNote?.("note-1", "Same");
    expect(files.writeProjectFile).not.toHaveBeenCalled();
  });

  it("lets an open editor write the title and logs a failed title write", async () => {
    const close = registerNoteEditor("note-1", noteEditorHandle());
    const again = registerNoteEditor("note-1", noteEditorHandle());
    const { notes } = service();
    await notes.renameNote?.("note-1", "Open");
    expect(tauri.readFileContent).not.toHaveBeenCalled();
    close();
    expect(noteEditorOpen("note-1")).toBe(true);
    again();
    expect(noteEditorOpen("note-1")).toBe(false);
    tauri.readFileContent.mockRejectedValue(new Error("gone"));
    await notes.renameNote?.("note-1", "Closed");
    expect(log.logError).toHaveBeenCalledWith("write the note title", expect.any(Error));
  });
});
