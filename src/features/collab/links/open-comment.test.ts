// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collabCommentFilePath: vi.fn(),
  openCommentThread: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabCommentFilePath: mocks.collabCommentFilePath,
}));
vi.mock("@/components/collab/comments-rail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/collab/comments-rail")>()),
  openCommentThread: mocks.openCommentThread,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { useComments } from "../comments/comments-store";
import { openLinkedComment } from "./open-comment";

const TARGET = { fileId: "file-intro", threadId: "thread-7" };

beforeEach(() => {
  vi.useFakeTimers();
  mocks.collabCommentFilePath.mockReset().mockResolvedValue("chapters/intro.tex");
  mocks.openCommentThread.mockReset();
  mocks.logError.mockReset().mockResolvedValue(undefined);
  useComments.setState({ projectId: null });
});

afterEach(() => {
  vi.useRealTimers();
  useComments.setState({ projectId: null });
});

describe("opening the comment a link points at", () => {
  it("opens the thread in its file at once when the project's comments are already open", async () => {
    useComments.setState({ projectId: "local-1" });
    await openLinkedComment("local-1", TARGET);
    expect(mocks.collabCommentFilePath).toHaveBeenCalledWith("local-1", "file-intro");
    expect(mocks.openCommentThread).toHaveBeenCalledWith("chapters/intro.tex", "thread-7");
  });

  it("waits for the linked project's comments to open, ignoring other projects", async () => {
    const opening = openLinkedComment("local-1", TARGET);
    await vi.advanceTimersByTimeAsync(0);
    useComments.setState({ projectId: "local-2" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.openCommentThread).not.toHaveBeenCalled();
    useComments.setState({ projectId: "local-1" });
    await opening;
    expect(mocks.openCommentThread).toHaveBeenCalledWith("chapters/intro.tex", "thread-7");
  });

  it("gives up quietly when the project's comments never open", async () => {
    const opening = openLinkedComment("local-1", TARGET);
    await vi.advanceTimersByTimeAsync(15_000);
    await opening;
    useComments.setState({ projectId: "local-1" });
    expect(mocks.openCommentThread).not.toHaveBeenCalled();
  });

  it("does nothing for a comment whose file the project no longer has", async () => {
    useComments.setState({ projectId: "local-1" });
    mocks.collabCommentFilePath.mockResolvedValue(null);
    await openLinkedComment("local-1", TARGET);
    expect(mocks.openCommentThread).not.toHaveBeenCalled();
  });

  it("logs and stops when the file cannot be looked up", async () => {
    useComments.setState({ projectId: "local-1" });
    const failure = { code: "unreachable", message: "offline" };
    mocks.collabCommentFilePath.mockRejectedValue(failure);
    await openLinkedComment("local-1", TARGET);
    expect(mocks.logError).toHaveBeenCalledWith("collab comment link", failure);
    expect(mocks.openCommentThread).not.toHaveBeenCalled();
  });
});
