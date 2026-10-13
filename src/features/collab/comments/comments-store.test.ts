// @vitest-environment jsdom

import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { setEditorDocumentPath } from "@oleafly/editor";
import { loadNamespace } from "@/i18n";
import type { CollabCommentsChanged, CollabCommentThread } from "@/lib/tauri";
import { useCommentsRail } from "@/components/collab/comments-rail";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "../live/live-store";
import { useCollabActivity } from "../sharing/activity-store";
import { ALICE_ID, BOB, BOB_ID, CAROL, CAROL_ID, person, projectMember, shareInfo } from "../tests/fixtures";
import { commentMessage, commentsStatus, commentThread, INTRO_FILE, threadList } from "../tests/comment-fixtures";

const mocks = vi.hoisted(() => ({
  collabCommentsStatus: vi.fn(),
  collabCommentThreadList: vi.fn(),
  collabCommentCreate: vi.fn(),
  collabCommentReply: vi.fn(),
  collabCommentEdit: vi.fn(),
  collabCommentDelete: vi.fn(),
  collabCommentResolve: vi.fn(),
  collabCommentReopen: vi.fn(),
  collabCommentThreadDelete: vi.fn(),
  installed: vi.fn(),
  released: vi.fn(),
  session: vi.fn((_path: string): unknown => null),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabCommentsStatus: mocks.collabCommentsStatus,
  collabCommentThreadList: mocks.collabCommentThreadList,
  collabCommentCreate: mocks.collabCommentCreate,
  collabCommentReply: mocks.collabCommentReply,
  collabCommentEdit: mocks.collabCommentEdit,
  collabCommentDelete: mocks.collabCommentDelete,
  collabCommentResolve: mocks.collabCommentResolve,
  collabCommentReopen: mocks.collabCommentReopen,
  collabCommentThreadDelete: mocks.collabCommentThreadDelete,
}));

vi.mock("@/lib/collab-live-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collab-live-bridge")>()),
  collabDocumentSession: mocks.session,
}));

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

import { commentSpansIn } from "./editor-comments";
import {
  createThread,
  deleteMessage,
  deleteThread,
  editMessage,
  openCommentFromEditor,
  reopenThread,
  replyToThread,
  resolveThread,
  startComments,
  useComments,
} from "./comments-store";

const MEMBERS = [projectMember(person(), "editor"), projectMember(BOB, "owner"), projectMember(CAROL, "viewer")];
const COMMENT_MEMBERS = [
  { accountId: ALICE_ID, displayName: "Alice Chen", login: "alice-chen" },
  { accountId: BOB_ID, displayName: "Bob Smith", login: "bobsmith" },
  { accountId: CAROL_ID, displayName: "Carol Diaz", login: "carol" },
];

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

async function loaded(count: number) {
  await waitFor(() => expect(useComments.getState().threads).toHaveLength(count));
}

function ids(): string[] {
  return useComments.getState().threads.map((thread) => thread.id);
}

function watchShown(): { shown: string[]; stop: () => void } {
  const shown: string[] = [];
  const stop = useComments.subscribe((state) => shown.push(...state.threads.map((thread) => thread.id)));
  return { shown, stop };
}

function fakeSession(revision: number, synchronized = true) {
  const listeners = new Set<() => void>();
  let release: () => void = () => undefined;
  const session = {
    phase: "open",
    revision,
    synchronized,
    settled: vi.fn(() =>
      session.synchronized ? Promise.resolve() : new Promise<void>((resolve) => (release = resolve)),
    ),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    catchUp(next: number) {
      session.revision = next;
      for (const listener of [...listeners]) listener();
    },
    finishTyping(next: number) {
      session.synchronized = true;
      session.revision = next;
      release();
    },
  };
  return session;
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  localStorage.clear();
  mocks.collabCommentsStatus.mockResolvedValue(commentsStatus());
  mocks.collabCommentThreadList.mockResolvedValue(threadList([]));
  mocks.session.mockReturnValue(null);
  useSettingsStore.setState({ railTab: "files", showTree: true });
  useFilesStore.setState({ projectId: "paper", activePath: "intro.tex" });
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
  useCollabActivity.getState().open(null);
  useCollabLiveStore.setState({ projectId: null, share: null, role: null, status: null, members: [] });
  useCommentsRail.setState({ visible: false, unread: false, canCompose: false, request: null, reveal: null });
});

describe("comments for a shared project", () => {
  it("shows comments only while the server and the project allow them and keeps the threads when hidden", async () => {
    start();
    await waitFor(() => expect(useCommentsRail.getState()).toMatchObject({ visible: true, canCompose: true }));
    expect(mocks.collabCommentsStatus).toHaveBeenCalledWith("paper");
    expect(mocks.installed).toHaveBeenCalledTimes(1);
    emit("collab-comments-status", { projectId: "paper", status: commentsStatus({ projectEnabled: false, canComment: false }) });
    expect(useCommentsRail.getState()).toMatchObject({ visible: false, canCompose: false });
    expect(mocks.released).toHaveBeenCalledTimes(1);
    emit("collab-comments-status", { projectId: "paper", status: commentsStatus() });
    expect(useCommentsRail.getState().visible).toBe(true);
    emit("collab-comments-status", { projectId: "paper", status: commentsStatus({ serverAllowed: false, canComment: false }) });
    expect(useCommentsRail.getState().visible).toBe(false);
    expect(mocks.collabCommentThreadDelete).not.toHaveBeenCalled();
    expect(mocks.collabCommentDelete).not.toHaveBeenCalled();
  });

  it("asks again whether comments are on when the server would not take some, and stops offering writing", async () => {
    start();
    await waitFor(() => expect(useCommentsRail.getState()).toMatchObject({ visible: true, canCompose: true }));
    expect(mocks.collabCommentsStatus).toHaveBeenCalledTimes(1);
    mocks.collabCommentsStatus.mockResolvedValue(commentsStatus({ projectEnabled: false, canComment: false }));
    act(() =>
      useCollabLiveStore.setState({
        commentsNotSent: [{ fileId: INTRO_FILE, path: "intro.tex", threadId: "t1", quote: "The", body: "late" }],
      }),
    );
    await waitFor(() => expect(useCommentsRail.getState()).toMatchObject({ visible: false, canCompose: false }));
    expect(mocks.collabCommentsStatus).toHaveBeenCalledTimes(2);
    act(() => useCollabLiveStore.getState().dismissCommentsNotSent());
    expect(mocks.collabCommentsStatus).toHaveBeenCalledTimes(2);
  });

  it("lets viewers read threads but never offers them writing", async () => {
    useCollabLiveStore.setState({ role: "viewer" });
    mocks.collabCommentsStatus.mockResolvedValue(commentsStatus({ canComment: false }));
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 0, to: 4 })]));
    start();
    await loaded(1);
    expect(useCommentsRail.getState()).toMatchObject({ visible: true, canCompose: false });
  });

  it("offers writing only while the project is live", async () => {
    useCollabLiveStore.setState({ status: null });
    start();
    await waitFor(() => expect(useCommentsRail.getState().visible).toBe(true));
    expect(useCommentsRail.getState().canCompose).toBe(false);
    act(() => useCollabLiveStore.setState({ status: { state: "connecting" } }));
    expect(useCommentsRail.getState().canCompose).toBe(true);
    act(() => useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 1_000 } }));
    expect(useCommentsRail.getState().canCompose).toBe(true);
    act(() => useCollabLiveStore.setState({ status: { state: "ended", reason: "signed_out" } }));
    expect(useCommentsRail.getState().canCompose).toBe(false);
  });

  it("loads the open file's threads in document order with detached ones last and follows file switches", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([
      commentThread("gone", null),
      commentThread("late", { from: 40, to: 44 }),
      commentThread("early", { from: 3, to: 9 }),
    ]));
    start();
    await loaded(3);
    expect(mocks.collabCommentThreadList).toHaveBeenCalledWith("paper", "intro.tex");
    expect(useComments.getState().threads.map((thread) => thread.id)).toEqual(["early", "late", "gone"]);
    expect(useComments.getState().path).toBe("intro.tex");
    mocks.collabCommentThreadList.mockResolvedValue(threadList([]));
    act(() => useFilesStore.setState({ activePath: "refs.tex" }));
    await loaded(0);
    expect(mocks.collabCommentThreadList).toHaveBeenLastCalledWith("paper", "refs.tex");
    expect(useComments.getState().path).toBe("refs.tex");
  });

  it("reloads when this file's comments change and marks what others wrote as unseen until the tab opens", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 0, to: 4 })]));
    start();
    await loaded(1);
    const reply = commentThread("t1", { from: 0, to: 4 }, {
      messages: [commentMessage("t1-first"), commentMessage("t1-reply", BOB_ID, "Fixed it")],
    });
    mocks.collabCommentThreadList.mockResolvedValue(threadList([reply]));
    emit("collab-comments-changed", changed());
    await waitFor(() => expect(useComments.getState().threads[0].messages).toHaveLength(2));
    expect(useCommentsRail.getState().unread).toBe(true);
    act(() => useSettingsStore.setState({ railTab: "comments" }));
    expect(useCommentsRail.getState().unread).toBe(false);
  });

  it("never marks the person's own changes as unseen", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 0, to: 4 })]));
    start();
    await loaded(1);
    mocks.collabCommentThreadList.mockResolvedValue(threadList([
      commentThread("t1", { from: 0, to: 4 }, {
        messages: [commentMessage("t1-first"), commentMessage("t1-mine", ALICE_ID, "Thanks")],
      }),
    ]));
    emit("collab-comments-changed", changed());
    await waitFor(() => expect(useComments.getState().threads[0].messages).toHaveLength(2));
    expect(useCommentsRail.getState().unread).toBe(false);
  });

  it("marks comments in another file as unseen without reloading this one", async () => {
    start();
    await waitFor(() => expect(mocks.collabCommentThreadList).toHaveBeenCalledTimes(1));
    emit("collab-comments-changed", changed({ fileIds: ["file-refs"], paths: ["refs.tex"] }));
    expect(useCommentsRail.getState().unread).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mocks.collabCommentThreadList).toHaveBeenCalledTimes(1);
    emit("collab-comments-changed", changed({ projectId: "other", fileIds: ["x"], paths: ["intro.tex"] }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mocks.collabCommentThreadList).toHaveBeenCalledTimes(1);
  });

  it("adds one Activity entry when someone mentions the person", async () => {
    start();
    await waitFor(() => expect(useCommentsRail.getState().visible).toBe(true));
    const mention = { fileId: INTRO_FILE, path: "chapters/intro.tex", threadId: "t1", messageId: "t1-first", author: BOB_ID };
    emit("collab-comments-changed", changed({ mentioned: [mention] }));
    emit("collab-comments-changed", changed({ mentioned: [mention] }));
    const entries = useCollabActivity.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "mentioned",
      accountId: BOB_ID,
      name: "Bob Smith",
      path: "chapters/intro.tex",
      threadId: "t1",
      messageId: "t1-first",
    });
    expect(useCollabActivity.getState().unread).toBe(true);
  });

  it("keeps a mention that arrives before the comment switches are known, and none while comments are off", async () => {
    let answer: (status: ReturnType<typeof commentsStatus>) => void = () => undefined;
    mocks.collabCommentsStatus.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    start();
    await waitFor(() => expect(mocks.listeners.has("collab-comments-changed")).toBe(true));
    const early = { fileId: INTRO_FILE, path: "intro.tex", threadId: "t1", messageId: "m-early", author: BOB_ID };
    emit("collab-comments-changed", changed({ mentioned: [early] }));
    expect(useCollabActivity.getState().entries.map((entry) => entry.kind)).toEqual(["mentioned"]);
    await act(async () => answer(commentsStatus({ projectEnabled: false, canComment: false })));
    const late = { ...early, messageId: "m-late" };
    emit("collab-comments-changed", changed({ mentioned: [late] }));
    expect(useCollabActivity.getState().entries).toHaveLength(1);
  });

  it("starts a draft from the editor and creates the thread with the project's members", async () => {
    start();
    await waitFor(() => expect(useCommentsRail.getState().canCompose).toBe(true));
    act(() => useCommentsRail.setState({ request: { path: "intro.tex", from: 4, to: 9, quote: "quick" } }));
    expect(useComments.getState().draft).toEqual({ path: "intro.tex", from: 4, to: 9, quote: "quick" });
    expect(useCommentsRail.getState().request).toBeNull();
    const created = commentThread("new", { from: 4, to: 9 }, { createdBy: ALICE_ID });
    mocks.collabCommentCreate.mockResolvedValue(created);
    await act(() => createThread("Check this @Bob Smith"));
    expect(mocks.collabCommentCreate).toHaveBeenCalledWith(
      "paper",
      "intro.tex",
      4,
      9,
      null,
      "Check this @Bob Smith",
      COMMENT_MEMBERS,
    );
    expect(useComments.getState()).toMatchObject({ draft: null, selectedId: "new" });
    expect(useComments.getState().threads.map((thread) => thread.id)).toEqual(["new"]);
  });

  it("replies, edits, deletes, resolves, reopens and deletes threads through the bridge", async () => {
    const original = commentThread("t1", { from: 0, to: 4 }, {
      messages: [commentMessage("m1", ALICE_ID, "First")],
      createdBy: ALICE_ID,
    });
    mocks.collabCommentThreadList.mockResolvedValue(threadList([original]));
    start();
    await loaded(1);
    const thread = useComments.getState().threads[0];
    mocks.collabCommentReply.mockResolvedValue(commentMessage("m2", ALICE_ID, "Second"));
    await act(() => replyToThread(thread, "Second"));
    expect(mocks.collabCommentReply).toHaveBeenCalledWith("paper", INTRO_FILE, "t1", "Second", COMMENT_MEMBERS);
    expect(useComments.getState().threads[0].messages.map((message) => message.body)).toEqual(["First", "Second"]);
    mocks.collabCommentEdit.mockResolvedValue(commentMessage("m1", ALICE_ID, "First, fixed", { editedAt: 5 }));
    await act(() => editMessage(thread, "m1", "First, fixed"));
    expect(mocks.collabCommentEdit).toHaveBeenCalledWith("paper", INTRO_FILE, "t1", "m1", "First, fixed", COMMENT_MEMBERS);
    expect(useComments.getState().threads[0].messages[0]).toMatchObject({ body: "First, fixed", editedAt: 5 });
    mocks.collabCommentDelete.mockResolvedValue(undefined);
    await act(() => deleteMessage(thread, "m2"));
    expect(mocks.collabCommentDelete).toHaveBeenCalledWith("paper", INTRO_FILE, "t1", "m2");
    expect(useComments.getState().threads[0].messages[1]).toMatchObject({ id: "m2", deleted: true });
    const resolved: CollabCommentThread = { ...original, resolved: { by: ALICE_ID, at: 9, verified: true } };
    mocks.collabCommentResolve.mockResolvedValue(resolved);
    await act(() => resolveThread(thread));
    expect(mocks.collabCommentResolve).toHaveBeenCalledWith("paper", INTRO_FILE, "t1");
    expect(useComments.getState().threads[0].resolved).toEqual({ by: ALICE_ID, at: 9, verified: true });
    mocks.collabCommentReopen.mockResolvedValue(original);
    await act(() => reopenThread(thread));
    expect(mocks.collabCommentReopen).toHaveBeenCalledWith("paper", INTRO_FILE, "t1");
    expect(useComments.getState().threads[0].resolved).toBeNull();
    mocks.collabCommentThreadDelete.mockResolvedValue(undefined);
    await act(() => deleteThread(thread));
    expect(mocks.collabCommentThreadDelete).toHaveBeenCalledWith("paper", INTRO_FILE, "t1");
    expect(useComments.getState().threads).toEqual([]);
  });

  it("selects a thread asked for from elsewhere once its file is loaded", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 0, to: 4 }), commentThread("t2", { from: 9, to: 12 })]));
    start();
    await loaded(2);
    const before = useComments.getState().focus;
    act(() => useCommentsRail.setState({ reveal: { path: "intro.tex", threadId: "t2" } }));
    await waitFor(() => expect(useComments.getState().selectedId).toBe("t2"));
    expect(useComments.getState().focus).toBeGreaterThan(before);
    expect(useCommentsRail.getState().reveal).toBeNull();
  });

  it("opens a thread from the editor and only shows a hidden sidebar for a marker click", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 0, to: 4 })]));
    start();
    await loaded(1);
    act(() => useSettingsStore.setState({ railTab: "files", showTree: false }));
    act(() => openCommentFromEditor("t1", "text"));
    expect(useComments.getState().selectedId).toBe("t1");
    expect(useSettingsStore.getState()).toMatchObject({ railTab: "files", showTree: false });
    act(() => useSettingsStore.setState({ showTree: true }));
    act(() => openCommentFromEditor("t1", "text"));
    expect(useSettingsStore.getState().railTab).toBe("comments");
    act(() => useSettingsStore.setState({ railTab: "files", showTree: false }));
    const focus = useComments.getState().focus;
    act(() => openCommentFromEditor("t1", "marker"));
    expect(useSettingsStore.getState()).toMatchObject({ railTab: "comments", showTree: true });
    expect(useComments.getState().focus).toBe(focus + 1);
  });

  it("clears everything when the project stops being shared", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 0, to: 4 })]));
    start();
    await loaded(1);
    act(() => useCollabLiveStore.setState({ share: null }));
    expect(useCommentsRail.getState()).toMatchObject({ visible: false, canCompose: false });
    expect(useComments.getState().threads).toEqual([]);
  });

  it("drops a list resolved against older text and asks again until it matches the editor", async () => {
    mocks.session.mockReturnValue(fakeSession(5));
    mocks.collabCommentThreadList
      .mockResolvedValueOnce(threadList([commentThread("old", { from: 0, to: 4 })], 4))
      .mockResolvedValue(threadList([commentThread("new", { from: 1, to: 5 })], 5));
    const watch = watchShown();
    start();
    await waitFor(() => expect(ids()).toEqual(["new"]));
    watch.stop();
    expect(watch.shown).not.toContain("old");
    expect(mocks.collabCommentThreadList).toHaveBeenCalledTimes(2);
  });

  it("waits for the person's own typing to reach the document before trusting a list", async () => {
    const session = fakeSession(5, false);
    mocks.session.mockReturnValue(session);
    mocks.collabCommentThreadList
      .mockResolvedValueOnce(threadList([commentThread("typing", { from: 0, to: 4 })], 5))
      .mockResolvedValue(threadList([commentThread("typed", { from: 2, to: 6 })], 6));
    const watch = watchShown();
    start();
    await waitFor(() => expect(session.settled).toHaveBeenCalled());
    expect(ids()).toEqual([]);
    act(() => session.finishTyping(6));
    await waitFor(() => expect(ids()).toEqual(["typed"]));
    watch.stop();
    expect(watch.shown).not.toContain("typing");
  });

  it("holds a list that is ahead of the editor until the editor catches up", async () => {
    const session = fakeSession(3);
    mocks.session.mockReturnValue(session);
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("ahead", { from: 0, to: 4 })], 4));
    start();
    await waitFor(() => expect(session.subscribe).toHaveBeenCalled());
    expect(ids()).toEqual([]);
    act(() => session.catchUp(4));
    await waitFor(() => expect(ids()).toEqual(["ahead"]));
    expect(mocks.collabCommentThreadList).toHaveBeenCalledTimes(2);
  });

  it("asks again for a list made before the editor had the file open", async () => {
    mocks.session.mockReturnValue(fakeSession(2));
    mocks.collabCommentThreadList
      .mockResolvedValueOnce(threadList([commentThread("unknown", { from: 0, to: 4 })], null))
      .mockResolvedValue(threadList([commentThread("known", { from: 0, to: 4 })], 2));
    const watch = watchShown();
    start();
    await waitFor(() => expect(ids()).toEqual(["known"]));
    watch.stop();
    expect(watch.shown).not.toContain("unknown");
  });

  it("shows the newest list after a few tries when the editor never matches", async () => {
    mocks.session.mockReturnValue(fakeSession(9));
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("late", { from: 0, to: 4 })], 8));
    start();
    await waitFor(() => expect(ids()).toEqual(["late"]));
    expect(mocks.collabCommentThreadList.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.collabCommentThreadList.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("creates the thread at the editor's revision and tries again when the text moved", async () => {
    const session = fakeSession(7);
    mocks.session.mockReturnValue(session);
    mocks.collabCommentThreadList.mockResolvedValue(threadList([], 7));
    start();
    await waitFor(() => expect(useCommentsRail.getState().canCompose).toBe(true));
    act(() => useCommentsRail.setState({ request: { path: "intro.tex", from: 4, to: 9, quote: "quick" } }));
    const created = commentThread("new", { from: 4, to: 9 }, { createdBy: ALICE_ID });
    mocks.collabCommentCreate
      .mockImplementationOnce(async () => {
        session.revision = 8;
        throw { code: "comment_selection_changed", message: "" };
      })
      .mockResolvedValue(created);
    await act(() => createThread("Look"));
    expect(mocks.collabCommentCreate.mock.calls.map((call) => call[4])).toEqual([7, 8]);
    expect(useComments.getState().selectedId).toBe("new");
  });

  it("gives up and reports a selection that keeps moving", async () => {
    mocks.session.mockReturnValue(fakeSession(7));
    start();
    await waitFor(() => expect(useCommentsRail.getState().canCompose).toBe(true));
    act(() => useCommentsRail.setState({ request: { path: "intro.tex", from: 4, to: 9, quote: "quick" } }));
    mocks.collabCommentCreate.mockRejectedValue({ code: "comment_selection_changed", message: "" });
    await expect(createThread("Look")).rejects.toMatchObject({ code: "comment_selection_changed" });
    expect(mocks.collabCommentCreate.mock.calls.length).toBeGreaterThan(1);
    expect(useComments.getState().draft).not.toBeNull();
  });

  it("never marks this app's own changes as unseen, here or in another file", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 0, to: 4 })]));
    start();
    await loaded(1);
    emit("collab-comments-changed", changed({ local: true, fileIds: ["file-refs"], paths: ["refs.tex"] }));
    expect(useCommentsRail.getState().unread).toBe(false);
    mocks.collabCommentThreadList.mockResolvedValue(
      threadList([
        commentThread("t1", { from: 0, to: 4 }, {
          messages: [commentMessage("t1-first"), commentMessage("t1-other", BOB_ID, "Raced in")],
        }),
      ]),
    );
    emit("collab-comments-changed", changed({ local: true }));
    await waitFor(() => expect(useComments.getState().threads[0].messages).toHaveLength(2));
    expect(useCommentsRail.getState().unread).toBe(false);
  });

  it("marks a thread whose text was deleted in the editor at once, then reloads the threads from the server", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 4, to: 9 })]));
    start();
    await loaded(1);
    const extension = mocks.installed.mock.calls[0]?.[0] as Extension;
    const view = new EditorView({
      state: EditorState.create({ doc: "The quick brown fox", extensions: extension }),
      parent: document.body,
    });
    try {
      act(() => setEditorDocumentPath("intro.tex"));
      await waitFor(() => expect(commentSpansIn(view.state)).toHaveLength(1));
      mocks.collabCommentThreadList.mockClear();
      mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", null)]));
      act(() => view.dispatch({ changes: { from: 2, to: 12, insert: "" } }));
      expect(useComments.getState().emptied).toEqual(["t1"]);
      expect(mocks.collabCommentThreadList).not.toHaveBeenCalled();
      await waitFor(() => expect(mocks.collabCommentThreadList).toHaveBeenCalledWith("paper", "intro.tex"), {
        timeout: 3_000,
      });
      await waitFor(() => expect(useComments.getState().threads[0].anchor.range).toBeNull());
      await waitFor(() => expect(useComments.getState().emptied).toEqual([]));
      expect(useCommentsRail.getState().unread).toBe(false);
    } finally {
      view.destroy();
      setEditorDocumentPath(null);
    }
  });

  it("reloads once after typing inside a commented passage pauses, to show the new quote", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 4, to: 9 })]));
    start();
    await loaded(1);
    const extension = mocks.installed.mock.calls[0]?.[0] as Extension;
    const view = new EditorView({
      state: EditorState.create({ doc: "The quick brown fox", extensions: extension }),
      parent: document.body,
    });
    try {
      act(() => setEditorDocumentPath("intro.tex"));
      await waitFor(() => expect(commentSpansIn(view.state)).toHaveLength(1));
      mocks.collabCommentThreadList.mockClear();
      for (const at of [5, 6, 7]) act(() => view.dispatch({ changes: { from: at, insert: "x" } }));
      act(() => view.dispatch({ changes: { from: 0, insert: "A " } }));
      await waitFor(() => expect(mocks.collabCommentThreadList).toHaveBeenCalledTimes(1), { timeout: 3_000 });
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      expect(mocks.collabCommentThreadList).toHaveBeenCalledTimes(1);
    } finally {
      view.destroy();
      setEditorDocumentPath(null);
    }
  });

  it("treats a message it could not verify as someone else's, even if it claims to be the person's", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 0, to: 4 })]));
    start();
    await loaded(1);
    mocks.collabCommentThreadList.mockResolvedValue(
      threadList([
        commentThread("t1", { from: 0, to: 4 }, {
          messages: [commentMessage("t1-first"), commentMessage("t1-fake", ALICE_ID, "Not me", { verified: false })],
        }),
      ]),
    );
    emit("collab-comments-changed", changed());
    await waitFor(() => expect(useComments.getState().threads[0].messages).toHaveLength(2));
    expect(useCommentsRail.getState().unread).toBe(true);
  });
});
