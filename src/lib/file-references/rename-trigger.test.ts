import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";

const mocks = vi.hoisted(() => ({
  startRename: vi.fn((_view: unknown) => true),
  startFileRenameAtCursor: vi.fn((_view: unknown) => true),
  activePath: "main.tex" as string | null,
}));

vi.mock("@/lib/index/nav", () => ({ startRename: mocks.startRename }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ activePath: mocks.activePath }) },
}));
vi.mock("./rename-at-cursor", () => ({ startFileRenameAtCursor: mocks.startFileRenameAtCursor }));

const view = {} as EditorView;

afterEach(() => {
  vi.clearAllMocks();
  mocks.activePath = "main.tex";
  vi.resetModules();
});

async function trigger() {
  return import("./rename-trigger");
}

describe("renameAtCursor", () => {
  it("goes straight to symbol rename outside LaTeX, Typst and Markdown", async () => {
    const { renameAtCursor } = await trigger();
    mocks.activePath = "refs.bib";
    mocks.startRename.mockReturnValueOnce(false);
    expect(renameAtCursor(view)).toBe(false);
    expect(mocks.startRename).toHaveBeenCalledWith(view);
    expect(mocks.startFileRenameAtCursor).not.toHaveBeenCalled();
  });

  it("loads the file rename on first use and falls back to symbol rename", async () => {
    const { renameAtCursor, loadFileRename } = await trigger();
    mocks.startFileRenameAtCursor.mockReturnValueOnce(false);
    expect(renameAtCursor(view)).toBe(true);
    await loadFileRename();
    await vi.waitFor(() => expect(mocks.startRename).toHaveBeenCalledWith(view));
    expect(mocks.startFileRenameAtCursor).toHaveBeenCalledWith(view);
  });

  it("decides synchronously once loaded", async () => {
    const { renameAtCursor, loadFileRename, loadedFileRename } = await trigger();
    expect(loadedFileRename()).toBeNull();
    await loadFileRename();
    expect(loadedFileRename()).not.toBeNull();
    expect(renameAtCursor(view)).toBe(true);
    expect(mocks.startFileRenameAtCursor).toHaveBeenCalledWith(view);
    expect(mocks.startRename).not.toHaveBeenCalled();

    mocks.startFileRenameAtCursor.mockReturnValueOnce(false);
    mocks.startRename.mockReturnValueOnce(false);
    expect(renameAtCursor(view)).toBe(false);
  });
});
