import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setFocus: vi.fn() }),
}));

import {
  cancelQuitFlush,
  confirmQuitFlush,
  createFile,
  importDocument,
  isFileConflictError,
  renameFile,
  validateCompileFingerprint,
} from "./tauri";

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe("createFile bridge", () => {
  it("returns the created path and generation", async () => {
    mocks.invoke.mockResolvedValue({ status: "created", path: "notes (2).tex", generation: 4 });

    const result = await createFile("project", "notes.tex", false, "keep_both");

    expect(result).toEqual({ path: "notes (2).tex", generation: 4 });
    expect(mocks.invoke).toHaveBeenCalledWith("create_file", {
      projectId: "project",
      path: "notes.tex",
      isDir: false,
      conflictStrategy: "keep_both",
      expectedGeneration: undefined,
    });
  });

  it("raises a structured conflict error carrying the suggestion", async () => {
    mocks.invoke.mockResolvedValue({
      status: "conflict",
      destination: "notes.tex",
      suggested_destination: "notes (2).tex",
      generation: 0,
    });

    const failure = await createFile("project", "notes.tex", false).catch((error) => error);

    expect(isFileConflictError(failure)).toBe(true);
    expect(failure.suggestedDestination).toBe("notes (2).tex");
  });
});

describe("renameFile bridge", () => {
  it("raises the same conflict error shape as create", async () => {
    mocks.invoke.mockResolvedValue({
      status: "conflict",
      destination: "b.tex",
      suggested_destination: "b (2).tex",
      generation: 0,
    });

    const failure = await renameFile("project", "a.tex", "b.tex").catch((error) => error);

    expect(isFileConflictError(failure)).toBe(true);
  });
});

describe("quit and fingerprint bridges", () => {
  it("passes the restart intent through confirm_quit_flush", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    await confirmQuitFlush(true);
    expect(mocks.invoke).toHaveBeenCalledWith("confirm_quit_flush", { restart: true });

    await cancelQuitFlush();
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_quit_flush");
  });

  it("forwards fingerprint validation and returns null verbatim", async () => {
    mocks.invoke.mockResolvedValue(null);
    await expect(validateCompileFingerprint("project", "main.tex")).resolves.toBeNull();
    expect(mocks.invoke).toHaveBeenCalledWith("validate_compile_fingerprint", {
      projectId: "project",
      mainDoc: "main.tex",
    });
  });
});

describe("document import bridge", () => {
  it("passes the selected document path to the native converter", async () => {
    mocks.invoke.mockResolvedValue("converted-project");

    await expect(importDocument("/tmp/paper.md")).resolves.toBe(
      "converted-project",
    );
    expect(mocks.invoke).toHaveBeenCalledWith("import_document", {
      path: "/tmp/paper.md",
    });
  });
});
