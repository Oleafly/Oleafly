import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectInfo } from "@/lib/tauri";
import { registerNoteEditor, type OpenNoteEditor } from "@/lib/open-note-editors";
import { useFilesStore } from "@/store/files";
import { restoreNoteVersion, saveNoteVersion, saveVersionBeforeAccept } from "./note-versions";

const checkpoints = vi.hoisted(() => ({ checkpointSave: vi.fn(), checkpointReadText: vi.fn() }));
vi.mock("@/lib/checkpoints", () => checkpoints);

const logs = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/log", () => logs);

function withProjects(...projects: Partial<ProjectInfo>[]) {
  useFilesStore.setState({ projects: projects as ProjectInfo[] });
}

afterEach(() => {
  vi.clearAllMocks();
  useFilesStore.setState({ projects: [] });
});

describe("note versions", () => {
  it.each([
    ["a note", { id: "note-1", kind: "note", main_doc: "note.md" }, true],
    ["a paper", { id: "note-1", kind: "latex", main_doc: "main.tex" }, false],
    ["a note kept inside a paper", { id: "paper-1", kind: "latex", main_doc: "main.tex" }, false],
  ])("saves a version before accepting all for %s only", (_name, project, saves) => {
    withProjects(project);
    checkpoints.checkpointSave.mockResolvedValue({ status: "unchanged" });
    saveVersionBeforeAccept("note-1", "# Before\n");
    if (saves) expect(checkpoints.checkpointSave).toHaveBeenCalledWith("note-1", "# Before\n");
    else expect(checkpoints.checkpointSave).not.toHaveBeenCalled();
  });

  it("saves what the open editor holds and reports a version that was not kept", async () => {
    withProjects({ id: "note-1", kind: "note", main_doc: "note.md" });
    const order: string[] = [];
    const flush = vi.fn(async () => {
      order.push("flush");
      return null;
    });
    const unregister = registerNoteEditor("note-1", { flush } as unknown as OpenNoteEditor);
    checkpoints.checkpointSave.mockImplementation(async () => {
      order.push("save");
      return { status: "published", snapshot_root: "root", created: true };
    });
    await expect(saveNoteVersion("note-1")).resolves.toBe(true);
    expect(order).toEqual(["flush", "save"]);
    checkpoints.checkpointSave.mockResolvedValue({ status: "unchanged" });
    await expect(saveNoteVersion("note-1")).resolves.toBe(false);
    checkpoints.checkpointSave.mockResolvedValue({ status: "published", snapshot_root: "older", created: false });
    await expect(saveNoteVersion("note-1")).resolves.toBe(false);
    checkpoints.checkpointSave.mockResolvedValue({ status: "skipped", reason: "incomplete_capture", message: "Not saved.", suggestion: "" });
    await expect(saveNoteVersion("note-1")).rejects.toThrow("Not saved.");
    unregister();
  });

  it("saves the note as it was, writes the restored text, then records the restored text as current", async () => {
    withProjects({ id: "note-1", kind: "note", main_doc: "note.md" });
    const order: string[] = [];
    checkpoints.checkpointReadText.mockImplementation(async () => {
      order.push("read");
      return "# Older\n";
    });
    checkpoints.checkpointSave.mockImplementation(async () => {
      order.push("checkpoint");
      return { status: "published", snapshot_root: "root", created: true };
    });
    const loadNote = vi.fn(async () => {
      order.push("load");
      return { text: "# Newer\n", version: "v2" };
    });
    const saveNote = vi.fn(async (_id: string, text: string) => {
      order.push("write");
      return { text, version: "v3" };
    });

    await restoreNoteVersion({ loadNote, saveNote }, "note-1", "older");

    expect(order).toEqual(["read", "checkpoint", "load", "write", "checkpoint"]);
    expect(saveNote).toHaveBeenCalledWith("note-1", "# Older\n", "v2");
    expect(checkpoints.checkpointSave).toHaveBeenLastCalledWith("note-1");
  });

  it("keeps a restored note when its text cannot be recorded as current", async () => {
    withProjects({ id: "note-1", kind: "note", main_doc: "note.md" });
    checkpoints.checkpointReadText.mockResolvedValue("# Older\n");
    checkpoints.checkpointSave
      .mockResolvedValueOnce({ status: "published", snapshot_root: "root", created: true })
      .mockResolvedValueOnce({ status: "skipped", reason: "storage_unavailable", message: "Disk full.", suggestion: "" });
    const saveNote = vi.fn(async (_id: string, text: string) => ({ text, version: "v3" }));

    await expect(
      restoreNoteVersion({ loadNote: async () => ({ text: "# Newer\n", version: "v2" }), saveNote }, "note-1", "older"),
    ).resolves.toBeUndefined();

    expect(saveNote).toHaveBeenCalledWith("note-1", "# Older\n", "v2");
    expect(logs.logError).toHaveBeenCalledWith("mark the restored note version as current", expect.any(Error));
  });
});
