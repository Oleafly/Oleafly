import { describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  notesImportFolder: vi.fn(),
  notesImportCancel: vi.fn(),
  notesExportFolder: vi.fn(),
}));
vi.mock("@/lib/tauri", () => tauri);

import { cancelImport, exportFolder, importFolder, newRunId, progressPercent, stepAfter } from "./note-vault";
import "./tests/setup";

describe("note vault client", () => {
  it("makes ids the import command accepts", () => {
    expect(newRunId()).toMatch(/^[0-9a-f-]{36}$/u);
    expect(newRunId()).not.toBe(newRunId());
  });

  it("spreads reading and writing over the bar", () => {
    expect(progressPercent(null)).toBe(0);
    expect(progressPercent({ phase: "read", done: 0, total: 0, file: "" })).toBe(0);
    expect(progressPercent({ phase: "read", done: 1, total: 4, file: "a.md" })).toBe(13);
    expect(progressPercent({ phase: "write", done: 4, total: 4, file: "a.md" })).toBe(100);
    expect(progressPercent({ phase: "write", done: 9, total: 4, file: "a.md" })).toBe(100);
  });

  it("turns command outcomes into dialog steps", () => {
    expect(stepAfter({ kind: "dismissed" })).toEqual({ step: "options" });
    expect(stepAfter({ kind: "seen", importedAt: 5, notes: 2 })).toEqual({ step: "seen", importedAt: 5, notes: 2 });
    expect(stepAfter({ kind: "large", notes: 4_000 })).toEqual({ step: "large", notes: 4_000 });
    expect(
      stepAfter({ kind: "done", notes: 1, attachments: 2, unresolved: 3, skipped: 4, cancelled: false, notCopied: ["figures/plot.png"], skippedNotes: ["big.md"] }),
    ).toEqual({
      step: "done",
      summary: { notes: 1, attachments: 2, unresolved: 3, skipped: 4, cancelled: false, notCopied: ["figures/plot.png"], skippedNotes: ["big.md"] },
    });
  });

  it("passes the run, the choices and translated titles to the commands", async () => {
    const onProgress = vi.fn();
    tauri.notesImportFolder.mockResolvedValue({ kind: "dismissed" });
    await importFolder("run-1", { folderTags: true, again: false, confirmLarge: true }, onProgress);
    expect(tauri.notesImportFolder).toHaveBeenCalledWith(
      { runId: "run-1", folderTags: true, again: false, files: false, confirmLarge: true, title: "Choose a folder to import" },
      onProgress,
    );
    await importFolder("run-2", { folderTags: false, again: false, files: true }, onProgress);
    expect(tauri.notesImportFolder).toHaveBeenLastCalledWith(
      { runId: "run-2", folderTags: false, again: false, files: true, confirmLarge: false, title: "Choose Markdown files to import" },
      onProgress,
    );
    tauri.notesImportCancel.mockResolvedValue(true);
    await expect(cancelImport("run-1")).resolves.toBe(true);
    tauri.notesExportFolder.mockResolvedValue(null);
    await exportFolder(null);
    expect(tauri.notesExportFolder).toHaveBeenLastCalledWith({
      noteId: null,
      folderName: "Oleafly notes",
      title: "Choose where to save the folder",
    });
    await exportFolder({ id: "n1", title: "Alpha" });
    expect(tauri.notesExportFolder).toHaveBeenLastCalledWith({
      noteId: "n1",
      folderName: "Alpha",
      title: "Choose where to save the folder",
    });
  });
});
