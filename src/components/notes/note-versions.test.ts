import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectInfo } from "@/lib/tauri";
import { registerNoteEditor, type OpenNoteEditor } from "@/lib/open-note-editors";
import { useFilesStore } from "@/store/files";
import { saveNoteVersion, saveVersionBeforeAccept } from "./note-versions";

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
    checkpoints.checkpointSave.mockResolvedValue({ status: "skipped", reason: "incomplete_capture", message: "Not saved.", suggestion: "" });
    await expect(saveNoteVersion("note-1")).rejects.toThrow("Not saved.");
    unregister();
  });
});
