// @vitest-environment jsdom

import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { setEditorDocumentPath, setEditorView } from "@oleafly/editor";
import { loadNamespace } from "@/i18n";
import type { CollabCommentsChanged, CollabCommentThread, CollabCommentThreadList } from "@/lib/tauri";
import { useCommentsRail } from "@/components/collab/comments-rail";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "../live/live-store";
import { useCollabActivity } from "../sharing/activity-store";
import { ALICE_ID, BOB, BOB_ID, person, projectMember, shareInfo } from "../tests/fixtures";
import { AT, commentMessage, commentsStatus, commentThread, INTRO_FILE, threadList } from "../tests/comment-fixtures";

const mocks = vi.hoisted(() => ({
  collabCommentsStatus: vi.fn(),
  collabCommentThreadList: vi.fn(),
  collabCommentCounts: vi.fn(),
  collabCommentCreate: vi.fn(),
  collabCommentReply: vi.fn(),
  collabCommentThreadDelete: vi.fn(),
  installed: vi.fn(),
  released: vi.fn(),
  logError: vi.fn(),
  openFile: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabCommentsStatus: mocks.collabCommentsStatus,
  collabCommentThreadList: mocks.collabCommentThreadList,
  collabCommentCounts: mocks.collabCommentCounts,
  collabCommentCreate: mocks.collabCommentCreate,
  collabCommentReply: mocks.collabCommentReply,
  collabCommentThreadDelete: mocks.collabCommentThreadDelete,
}));

vi.mock("@/lib/collab-live-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collab-live-bridge")>()),
  collabDocumentSession: () => null,
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(event, handler);
    return () => mocks.listeners.delete(event);
  }),
}));

vi.mock("@/components/editor/cm/comments-slot", () => ({
  setCommentsEditorExtension: (extension: unknown) => {
    mocks.installed(extension);
    return mocks.released;
  },
}));

import {
  byDocument,
  collapseFile,
  commentSelf,
  createThread,
  deleteThread,
  expandFile,
  openThreadIn,
  replyToThread,
  selectThread,
  setShowResolved,
  startComments,
  useComments,
} from "./comments-store";

const MEMBERS = [projectMember(person(), "editor"), projectMember(BOB, "owner")];
const REFS_FILE = "file-refs";

let stop: (() => void) | null = null;

function start() {
  stop = startComments();
}

function emit(event: string, payload: unknown) {
  act(() => mocks.listeners.get(event)?.({ payload }));
}

function changed(overrides: Partial<CollabCommentsChanged> = {}): CollabCommentsChanged {
  return { projectId: "paper", fileIds: [INTRO_FILE], paths: ["intro.tex"], mentioned: [], local: false, ...overrides };
}

function refsThread(id: string, from: number): CollabCommentThread {
  return commentThread(id, { from, to: from + 3 }, { fileId: REFS_FILE });
}

function listsBy(byPath: Record<string, () => Promise<CollabCommentThreadList>>) {
  mocks.collabCommentThreadList.mockImplementation((_project: string, path: string) =>
    (byPath[path] ?? (async () => threadList([])))(),
  );
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function ready() {
  await waitFor(() => expect(useComments.getState().phase).toBe("ready"));
}

async function counted() {
  await ready();
  await waitFor(() => expect(useComments.getState().counts).not.toBeNull());
}

async function shown() {
  await waitFor(() => expect(useCommentsRail.getState().visible).toBe(true));
}

function refusal(code: string) {
  return { code, message: "" };
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  localStorage.clear();
  mocks.logError.mockResolvedValue(undefined);
  mocks.openFile.mockResolvedValue(undefined);
  mocks.collabCommentsStatus.mockResolvedValue(commentsStatus());
  mocks.collabCommentThreadList.mockResolvedValue(threadList([]));
  mocks.collabCommentCounts.mockResolvedValue([]);
  useSettingsStore.setState({ railTab: "files", showTree: true });
  useFilesStore.setState({ projectId: "paper", activePath: "intro.tex", openFile: mocks.openFile });
  useCollabLiveStore.setState({
    projectId: "paper",
    share: shareInfo({ project_id: "paper", role: "editor", account_id: ALICE_ID }),
    role: "editor",
    status: { state: "online" },
    members: MEMBERS,
  });
  useCollabActivity.getState().open("paper");
});

afterEach(() => {
  stop?.();
  stop = null;
  setEditorView(null);
  setEditorDocumentPath(null);
  useCollabActivity.getState().open(null);
  useCollabLiveStore.setState({ projectId: null, share: null, role: null, status: null, members: [] });
  useCommentsRail.setState({ visible: false, unread: false, canCompose: false, request: null, reveal: null });
  useComments.setState({ showResolved: false });
});

describe("ordering and identity helpers", () => {
  it("orders threads by start, then end, then age, with detached threads last by age", () => {
    const early = commentThread("early", { from: 2, to: 9 }, { createdAt: AT + 5 });
    const shorter = commentThread("shorter", { from: 2, to: 4 }, { createdAt: AT + 9 });
    const older = commentThread("older", { from: 2, to: 9 }, { createdAt: AT });
    const detachedNew = commentThread("detached-new", null, { createdAt: AT + 7 });
    const detachedOld = commentThread("detached-old", null, { createdAt: AT + 1 });
    expect(byDocument([detachedNew, early, detachedOld, shorter, older]).map((thread) => thread.id)).toEqual([
      "shorter",
      "older",
      "early",
      "detached-old",
      "detached-new",
    ]);
  });

  it("knows no comment author before the project is shared", () => {
    useCollabLiveStore.setState({ share: null });
    expect(commentSelf()).toBeNull();
    useCollabLiveStore.setState({ share: shareInfo({ project_id: "paper", account_id: BOB_ID }) });
    expect(commentSelf()).toBe(BOB_ID);
  });
});

describe("loading the open file's threads", () => {
  it("shows a failed list with the reason when the server cannot list the file's threads", async () => {
    mocks.collabCommentThreadList.mockRejectedValue(refusal("unreachable"));
    start();
    await waitFor(() => expect(useComments.getState().phase).toBe("failed"));
    expect(useComments.getState()).toMatchObject({ error: "unreachable", threads: [] });
    expect(mocks.logError).toHaveBeenCalledWith("collab comments load", refusal("unreachable"));
  });

  it("shows an empty list without logging for a file the server has never seen", async () => {
    mocks.collabCommentThreadList.mockRejectedValue(refusal("not_found"));
    start();
    await ready();
    expect(useComments.getState()).toMatchObject({ threads: [], error: null, selectedId: null });
    expect(mocks.logError).not.toHaveBeenCalledWith("collab comments load", expect.anything());
  });

  it("shows nothing when no file is open or the open project is a different one", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 0, to: 4 })]));
    start();
    await waitFor(() => expect(useComments.getState().threads).toHaveLength(1));
    act(() => useFilesStore.setState({ activePath: null }));
    await waitFor(() => expect(useComments.getState()).toMatchObject({ path: null, phase: "idle", threads: [] }));
    act(() => useFilesStore.setState({ activePath: "intro.tex" }));
    await waitFor(() => expect(useComments.getState().threads).toHaveLength(1));
    act(() => useFilesStore.setState({ projectId: "other" }));
    await waitFor(() => expect(useComments.getState()).toMatchObject({ path: null, phase: "idle", threads: [] }));
  });

  it("keeps the selected thread selected when a reload still lists it", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(
      threadList([commentThread("t1", { from: 0, to: 4 }), commentThread("t2", { from: 6, to: 9 })]),
    );
    start();
    await waitFor(() => expect(useComments.getState().threads).toHaveLength(2));
    act(() => selectThread("t2"));
    mocks.collabCommentThreadList.mockResolvedValue(
      threadList([
        commentThread("t1", { from: 0, to: 4 }),
        commentThread("t2", { from: 6, to: 9 }, { messages: [commentMessage("t2-first"), commentMessage("t2-more")] }),
      ]),
    );
    emit("collab-comments-changed", changed());
    await waitFor(() => expect(useComments.getState().threads[1].messages).toHaveLength(2));
    expect(useComments.getState().selectedId).toBe("t2");
  });

  it("does not reload when the files store changes something other than the open file", async () => {
    start();
    await ready();
    const calls = mocks.collabCommentThreadList.mock.calls.length;
    act(() => useFilesStore.setState({ openFile: vi.fn() }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.collabCommentThreadList).toHaveBeenCalledTimes(calls);
  });

  it("does not load threads for a newly opened file while comments are off for the project", async () => {
    mocks.collabCommentsStatus.mockResolvedValue(commentsStatus({ projectEnabled: false, canComment: false }));
    start();
    await waitFor(() => expect(mocks.collabCommentsStatus).toHaveBeenCalled());
    act(() => useFilesStore.setState({ activePath: "refs.tex" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.collabCommentThreadList).not.toHaveBeenCalled();
    expect(useComments.getState().path).toBeNull();
  });
});

describe("other people's changes", () => {
  it("marks a thread someone else resolved as unseen", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 0, to: 4 })]));
    start();
    await waitFor(() => expect(useComments.getState().threads).toHaveLength(1));
    mocks.collabCommentThreadList.mockResolvedValue(
      threadList([commentThread("t1", { from: 0, to: 4 }, { resolved: { by: BOB_ID, at: AT, verified: true } })]),
    );
    emit("collab-comments-changed", changed());
    await waitFor(() => expect(useComments.getState().threads[0].resolved).not.toBeNull());
    expect(useCommentsRail.getState().unread).toBe(true);
  });

  it("does not mark the person's own verified resolve as unseen", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 0, to: 4 })]));
    start();
    await waitFor(() => expect(useComments.getState().threads).toHaveLength(1));
    mocks.collabCommentThreadList.mockResolvedValue(
      threadList([commentThread("t1", { from: 0, to: 4 }, { resolved: { by: ALICE_ID, at: AT, verified: true } })]),
    );
    emit("collab-comments-changed", changed());
    await waitFor(() => expect(useComments.getState().threads[0].resolved).not.toBeNull());
    expect(useCommentsRail.getState().unread).toBe(false);
  });

  it("ignores a change that names no file and a status meant for another project", async () => {
    start();
    await shown();
    emit("collab-comments-changed", changed({ fileIds: [], paths: [] }));
    expect(useCommentsRail.getState().unread).toBe(false);
    emit("collab-comments-status", { projectId: "other", status: commentsStatus({ projectEnabled: false }) });
    expect(useCommentsRail.getState().visible).toBe(true);
  });

  it("names a mention from someone who is not a member with an empty name", async () => {
    start();
    await shown();
    const mention = { fileId: INTRO_FILE, path: "intro.tex", threadId: "t1", messageId: "m-x", author: "stranger" };
    emit("collab-comments-changed", changed({ mentioned: [mention] }));
    expect(useCollabActivity.getState().entries[0]).toMatchObject({ kind: "mentioned", accountId: "stranger", name: "" });
  });

  it("keeps the unseen dot when settings unrelated to the Comments tab change", async () => {
    start();
    await shown();
    emit("collab-comments-changed", changed({ fileIds: [REFS_FILE], paths: ["refs.tex"] }));
    expect(useCommentsRail.getState().unread).toBe(true);
    act(() => useSettingsStore.setState({ liveCollaboration: true }));
    expect(useCommentsRail.getState().unread).toBe(true);
  });
});

describe("asking the server again", () => {
  it("asks for the comment switches again when the person's role changes or they come back online", async () => {
    start();
    await shown();
    expect(mocks.collabCommentsStatus).toHaveBeenCalledTimes(1);
    act(() => useCollabLiveStore.setState({ role: "viewer" }));
    await waitFor(() => expect(mocks.collabCommentsStatus).toHaveBeenCalledTimes(2));
    expect(useCommentsRail.getState().canCompose).toBe(false);
    act(() => useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 1_000 } }));
    expect(mocks.collabCommentsStatus).toHaveBeenCalledTimes(2);
    act(() => useCollabLiveStore.setState({ status: { state: "online" } }));
    await waitFor(() => expect(mocks.collabCommentsStatus).toHaveBeenCalledTimes(3));
  });

  it("keeps the loaded threads when the same project's share details are refreshed", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 0, to: 4 })]));
    start();
    await waitFor(() => expect(useComments.getState().threads).toHaveLength(1));
    act(() =>
      useCollabLiveStore.setState({ share: shareInfo({ project_id: "paper", role: "editor", account_id: ALICE_ID }) }),
    );
    expect(useComments.getState().threads).toHaveLength(1);
    expect(mocks.collabCommentsStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps the comment counts empty when they cannot be read and logs only real failures", async () => {
    mocks.collabCommentCounts.mockRejectedValue(refusal("unreachable"));
    start();
    await waitFor(() => expect(useComments.getState().counts).toEqual([]));
    expect(mocks.logError).toHaveBeenCalledWith("collab comment counts", refusal("unreachable"));
    mocks.logError.mockClear();
    mocks.collabCommentCounts.mockRejectedValue(refusal("not_found"));
    const before = useComments.getState().counts;
    emit("collab-comments-changed", changed({ fileIds: [REFS_FILE], paths: ["refs.tex"] }));
    await waitFor(() => expect(mocks.collabCommentCounts).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useComments.getState().counts).toBe(before);
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});

describe("threads in other files", () => {
  it("folds away an expanded file the counts no longer list", async () => {
    mocks.collabCommentCounts.mockResolvedValue([{ path: "refs.tex", open: 1, resolved: 0 }]);
    listsBy({ "refs.tex": async () => threadList([refsThread("r1", 0)]) });
    start();
    await waitFor(() => expect(useComments.getState().counts).toHaveLength(1));
    act(() => expandFile("refs.tex"));
    act(() => expandFile("notes.tex"));
    await waitFor(() => expect(useComments.getState().elsewhere["refs.tex"]?.phase).toBe("ready"));
    await waitFor(() => expect(useComments.getState().elsewhere["notes.tex"]?.phase).toBe("ready"));
    const counts = useComments.getState().counts;
    emit("collab-comments-changed", changed({ fileIds: [], paths: ["other.tex"] }));
    await waitFor(() => expect(Object.keys(useComments.getState().elsewhere)).toEqual(["refs.tex"]));
    expect(useComments.getState().counts).toBe(counts);
    mocks.collabCommentCounts.mockResolvedValue([]);
    emit("collab-comments-changed", changed({ fileIds: [REFS_FILE], paths: [] }));
    await waitFor(() => expect(useComments.getState().elsewhere).toEqual({}));
    expect(useComments.getState().counts).toEqual([]);
  });

  it("shows an expanded file as failed when its threads cannot load, and tries again when expanded again", async () => {
    let answer = Promise.reject<CollabCommentThreadList>(refusal("unreachable"));
    answer.catch(() => undefined);
    listsBy({ "refs.tex": () => answer });
    start();
    await counted();
    act(() => expandFile("refs.tex"));
    await waitFor(() => expect(useComments.getState().elsewhere["refs.tex"]?.phase).toBe("failed"));
    expect(useComments.getState().elsewhere["refs.tex"]?.error).toBe("unreachable");
    expect(mocks.logError).toHaveBeenCalledWith("collab comments load", refusal("unreachable"));
    answer = Promise.resolve(threadList([refsThread("r1", 0)]));
    act(() => expandFile("refs.tex"));
    expect(useComments.getState().elsewhere["refs.tex"]?.phase).toBe("loading");
    await waitFor(() => expect(useComments.getState().elsewhere["refs.tex"]?.phase).toBe("ready"));
    expect(useComments.getState().elsewhere["refs.tex"]?.threads.map((thread) => thread.id)).toEqual(["r1"]);
  });

  it("shows an expanded file the server no longer knows as having no threads", async () => {
    listsBy({ "refs.tex": () => Promise.reject(refusal("not_found")) });
    start();
    await counted();
    act(() => expandFile("refs.tex"));
    await waitFor(() =>
      expect(useComments.getState().elsewhere["refs.tex"]).toEqual({ phase: "ready", error: null, threads: [] }),
    );
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("uses only the newest answer for a file expanded twice and drops answers for a folded file", async () => {
    const first = deferred<CollabCommentThreadList>();
    const second = deferred<CollabCommentThreadList>();
    const pending = [first, second];
    listsBy({ "refs.tex": () => (pending.shift() ?? second).promise });
    start();
    await counted();
    act(() => expandFile("refs.tex"));
    const loading = useComments.getState().elsewhere;
    act(() => expandFile("refs.tex"));
    expect(useComments.getState().elsewhere).toBe(loading);
    await act(async () => first.resolve(threadList([refsThread("stale", 0)])));
    expect(useComments.getState().elsewhere["refs.tex"]?.phase).toBe("loading");
    await act(async () => second.resolve(threadList([refsThread("fresh", 0)])));
    expect(useComments.getState().elsewhere["refs.tex"]?.threads.map((thread) => thread.id)).toEqual(["fresh"]);

    const failing = deferred<CollabCommentThreadList>();
    const failingLater = deferred<CollabCommentThreadList>();
    const notes = [failing, failingLater];
    listsBy({ "notes.tex": () => (notes.shift() ?? failingLater).promise });
    act(() => expandFile("notes.tex"));
    act(() => expandFile("notes.tex"));
    await act(async () => failing.reject(refusal("unreachable")));
    expect(useComments.getState().elsewhere["notes.tex"]?.phase).toBe("loading");
    act(() => collapseFile("notes.tex"));
    await act(async () => failingLater.resolve(threadList([refsThread("n1", 0)])));
    expect(useComments.getState().elsewhere["notes.tex"]).toBeUndefined();
    const elsewhere = useComments.getState().elsewhere;
    act(() => collapseFile("never-opened.tex"));
    expect(useComments.getState().elsewhere).toBe(elsewhere);
  });

  it("keeps an expanded file untouched when a reload finds the same threads", async () => {
    mocks.collabCommentCounts.mockResolvedValue([{ path: "refs.tex", open: 1, resolved: 0 }]);
    listsBy({ "refs.tex": async () => threadList([refsThread("r1", 0)]) });
    start();
    await counted();
    act(() => expandFile("refs.tex"));
    await waitFor(() => expect(useComments.getState().elsewhere["refs.tex"]?.phase).toBe("ready"));
    const entry = useComments.getState().elsewhere["refs.tex"];
    emit("collab-comments-changed", changed({ fileIds: [REFS_FILE], paths: ["refs.tex"] }));
    await waitFor(() =>
      expect(mocks.collabCommentThreadList.mock.calls.filter(([, path]) => path === "refs.tex")).toHaveLength(2),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useComments.getState().elsewhere["refs.tex"]).toBe(entry);
  });

  it("replies and deletes in a thread shown under an expanded file without touching the open file", async () => {
    mocks.collabCommentCounts.mockResolvedValue([{ path: "refs.tex", open: 1, resolved: 0 }]);
    const here = commentThread("t1", { from: 0, to: 4 });
    mocks.collabCommentThreadList.mockImplementation(async (_project: string, path: string) =>
      path === "refs.tex" ? threadList([refsThread("r1", 0)]) : threadList([here]),
    );
    start();
    await counted();
    expect(useComments.getState().threads).toHaveLength(1);
    act(() => expandFile("refs.tex"));
    await waitFor(() => expect(useComments.getState().elsewhere["refs.tex"]?.phase).toBe("ready"));
    const threads = useComments.getState().threads;
    const remote = useComments.getState().elsewhere["refs.tex"].threads[0];
    mocks.collabCommentReply.mockResolvedValue(commentMessage("r1-reply", ALICE_ID, "Agreed"));
    await act(() => replyToThread(remote, "Agreed"));
    expect(useComments.getState().elsewhere["refs.tex"].threads[0].messages.map((message) => message.id)).toEqual([
      "r1-first",
      "r1-reply",
    ]);
    expect(useComments.getState().threads).toBe(threads);
    const before = useComments.getState();
    await act(() => deleteThread(commentThread("missing", null)));
    expect(useComments.getState()).toBe(before);
  });

  it("clears the selection when the selected thread is deleted", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(
      threadList([commentThread("t1", { from: 0, to: 4 }), commentThread("t2", { from: 6, to: 9 })]),
    );
    start();
    await waitFor(() => expect(useComments.getState().threads).toHaveLength(2));
    act(() => selectThread("t2"));
    await act(() => deleteThread(useComments.getState().threads[1]));
    expect(useComments.getState()).toMatchObject({ selectedId: null });
    expect(useComments.getState().threads.map((thread) => thread.id)).toEqual(["t1"]);
  });

  it("selects a thread in the open file in place and opens another file for a thread elsewhere", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 0, to: 4 })]));
    start();
    await waitFor(() => expect(useComments.getState().threads).toHaveLength(1));
    act(() => openThreadIn("intro.tex", "t1"));
    expect(useComments.getState().selectedId).toBe("t1");
    expect(mocks.openFile).not.toHaveBeenCalled();
    act(() => openThreadIn("refs.tex", "r1"));
    expect(mocks.openFile).toHaveBeenCalledWith("refs.tex");
    expect(useCommentsRail.getState().reveal).toEqual({ path: "refs.tex", threadId: "r1" });
  });
});

describe("selection and visibility", () => {
  it("drops the selection when resolved threads are hidden and the selected one is resolved", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(
      threadList([
        commentThread("open", { from: 0, to: 4 }),
        commentThread("done", { from: 6, to: 9 }, { resolved: { by: BOB_ID, at: AT, verified: true } }),
      ]),
    );
    start();
    await waitFor(() => expect(useComments.getState().threads).toHaveLength(2));
    act(() => setShowResolved(true));
    act(() => selectThread("done"));
    act(() => setShowResolved(false));
    expect(useComments.getState()).toMatchObject({ showResolved: false, selectedId: null });
    act(() => selectThread("open"));
    act(() => setShowResolved(false));
    expect(useComments.getState().selectedId).toBe("open");
  });

  it("forgets a reveal for a thread the file no longer has", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 0, to: 4 })]));
    start();
    await waitFor(() => expect(useComments.getState().threads).toHaveLength(1));
    act(() => useCommentsRail.setState({ reveal: { path: "intro.tex", threadId: "gone" } }));
    expect(useCommentsRail.getState().reveal).toBeNull();
    expect(useComments.getState().selectedId).toBeNull();
  });

  it("does not start a draft when the person cannot write comments", async () => {
    mocks.collabCommentsStatus.mockResolvedValue(commentsStatus({ canComment: false }));
    start();
    await shown();
    act(() => useCommentsRail.setState({ request: { path: "intro.tex", from: 0, to: 3, quote: "The" } }));
    expect(useCommentsRail.getState().request).toBeNull();
    expect(useComments.getState().draft).toBeNull();
  });
});

describe("writing comments", () => {
  it("refuses to write while the project is not shared", async () => {
    await expect(replyToThread(commentThread("t1", null), "Hi")).rejects.toThrow("This project is not shared.");
    expect(mocks.collabCommentReply).not.toHaveBeenCalled();
  });

  it("does nothing when there is no draft to create", async () => {
    start();
    await shown();
    await act(() => createThread("Nothing selected"));
    expect(mocks.collabCommentCreate).not.toHaveBeenCalled();
  });

  it("keeps a newer draft and the open file's list when a thread is created for another file", async () => {
    start();
    await waitFor(() => expect(useCommentsRail.getState().canCompose).toBe(true));
    act(() => useCommentsRail.setState({ request: { path: "refs.tex", from: 0, to: 4, quote: "Refs" } }));
    const created = deferred<CollabCommentThread>();
    mocks.collabCommentCreate.mockReturnValue(created.promise);
    let creating: Promise<void> = Promise.resolve();
    act(() => {
      creating = createThread("Elsewhere");
    });
    await waitFor(() => expect(mocks.collabCommentCreate).toHaveBeenCalled());
    const newer = { path: "intro.tex", from: 4, to: 9, quote: "quick" };
    act(() => useCommentsRail.setState({ request: newer }));
    await act(async () => {
      created.resolve(commentThread("r-new", { from: 0, to: 4 }, { fileId: REFS_FILE }));
      await creating;
    });
    expect(useComments.getState()).toMatchObject({ draft: newer, selectedId: "r-new", threads: [] });
  });

  it("creates the thread where the draft now sits after typing moved it in the editor", async () => {
    start();
    await waitFor(() => expect(useCommentsRail.getState().canCompose).toBe(true));
    const extension = mocks.installed.mock.calls[0]?.[0] as Extension;
    const view = new EditorView({
      state: EditorState.create({ doc: "The quick brown fox", extensions: extension }),
      parent: document.body,
    });
    try {
      act(() => {
        setEditorView(view);
        setEditorDocumentPath("intro.tex");
      });
      act(() => useCommentsRail.setState({ request: { path: "intro.tex", from: 4, to: 9, quote: "quick" } }));
      await waitFor(() => expect(view.dom.querySelector(".cm-comment-draft")).not.toBeNull());
      act(() => view.dispatch({ changes: { from: 0, insert: "So " } }));
      mocks.collabCommentCreate.mockResolvedValue(commentThread("new", { from: 7, to: 12 }));
      await act(() => createThread("Moved"));
      expect(mocks.collabCommentCreate.mock.calls[0].slice(1, 4)).toEqual(["intro.tex", 7, 12]);
    } finally {
      view.destroy();
    }
  });

  it("falls back to the draft's own range when the editor shows the file without a draft mark", async () => {
    start();
    await waitFor(() => expect(useCommentsRail.getState().canCompose).toBe(true));
    const view = new EditorView({ state: EditorState.create({ doc: "The quick brown fox" }), parent: document.body });
    try {
      act(() => {
        setEditorView(view);
        setEditorDocumentPath("intro.tex");
      });
      act(() => useCommentsRail.setState({ request: { path: "intro.tex", from: 4, to: 9, quote: "quick" } }));
      mocks.collabCommentCreate.mockResolvedValue(commentThread("new", { from: 4, to: 9 }));
      await act(() => createThread("Plain"));
      expect(mocks.collabCommentCreate.mock.calls[0].slice(1, 4)).toEqual(["intro.tex", 4, 9]);
    } finally {
      view.destroy();
    }
  });
});
