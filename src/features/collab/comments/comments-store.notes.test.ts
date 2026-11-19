// @vitest-environment jsdom

import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import { useCommentsRail } from "@/components/collab/comments-rail";
import {
  type NoteCommentSurface,
  openNoteComment,
  registerNoteCommentSurface,
  useCollabLiveNote,
  useNoteCommentsRequest,
} from "@/lib/collab-live-bridge";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "../live/live-store";
import { useCollabActivity } from "../sharing/activity-store";
import { ALICE_ID, BOB, person, projectMember, shareInfo } from "../tests/fixtures";
import { commentsStatus, commentThread, threadList } from "../tests/comment-fixtures";

const mocks = vi.hoisted(() => ({
  collabCommentsStatus: vi.fn(),
  collabCommentThreadList: vi.fn(),
  collabCommentCounts: vi.fn(),
  collabCommentCreate: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabCommentsStatus: mocks.collabCommentsStatus,
  collabCommentThreadList: mocks.collabCommentThreadList,
  collabCommentCounts: mocks.collabCommentCounts,
  collabCommentCreate: mocks.collabCommentCreate,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(event, handler);
    return () => mocks.listeners.delete(event);
  }),
}));

vi.mock("@/components/editor/cm/comments-slot", () => ({
  setCommentsEditorExtension: () => () => undefined,
}));

import { createThread, startComments, useComments } from "./comments-store";

const NOTE = "note-1";
const NOTE_PATH = "Masking.md";

let stop: (() => void) | null = null;
let releases: (() => void)[] = [];

function fakeNoteSession(revision: number) {
  return {
    phase: "open",
    revision,
    synchronized: true,
    settled: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn(() => () => undefined),
  };
}

function noteSurface(overrides: Partial<NoteCommentSurface> = {}) {
  const surface = {
    projectId: NOTE,
    path: NOTE_PATH,
    session: fakeNoteSession(7) as unknown as NoteCommentSurface["session"],
    flush: vi.fn(),
    show: vi.fn(),
    draft: vi.fn((): { from: number; to: number } | null => null),
    target: vi.fn(() => null),
    reveal: vi.fn(() => true),
    ...overrides,
  };
  releases.push(registerNoteCommentSurface(surface));
  return surface;
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
  mocks.collabCommentCounts.mockResolvedValue([]);
  useSettingsStore.setState({ railTab: "files", showTree: true });
  useFilesStore.setState({
    projectId: "paper",
    activePath: "intro.tex",
    projects: [{ id: NOTE, name: "Masking", main_doc: NOTE_PATH } as never],
  });
  useCollabLiveNote.setState({ noteId: NOTE });
  useCollabLiveStore.setState({
    projectId: NOTE,
    share: shareInfo({ project_id: NOTE, role: "editor", account_id: ALICE_ID }),
    role: "editor",
    status: { state: "online" },
    members: [projectMember(person(), "editor"), projectMember(BOB, "owner")],
  });
  useCollabActivity.getState().open(NOTE);
});

afterEach(() => {
  stop?.();
  stop = null;
  for (const release of releases) release();
  releases = [];
  useCollabActivity.getState().open(null);
  useCollabLiveNote.setState({ noteId: null });
  useCollabLiveStore.setState({ projectId: null, share: null, role: null, status: null, members: [] });
  useCommentsRail.setState({ visible: false, unread: false, canCompose: false, request: null, reveal: null });
});

describe("comments in a shared note", () => {
  it("loads the live note's threads from its own file and draws them in the note", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(
      threadList([commentThread("t1", { from: 4, to: 11 }), commentThread("t2", { from: 20, to: 26 }, { resolved: { by: BOB.account_id, at: 1, verified: true } })]),
    );
    const surface = noteSurface();
    stop = startComments();
    await waitFor(() => expect(useComments.getState().threads).toHaveLength(2));
    expect(mocks.collabCommentThreadList).toHaveBeenCalledWith(NOTE, NOTE_PATH);
    expect(useComments.getState().path).toBe(NOTE_PATH);
    await waitFor(() =>
      expect(surface.show).toHaveBeenLastCalledWith({
        spans: [
          { id: "t1", from: 4, to: 11, resolved: false },
          { id: "t2", from: 20, to: 26, resolved: true },
        ],
        selected: null,
        draft: null,
      }),
    );
  });

  it("draws in a note editor that goes live after the threads loaded, and clears the one that leaves", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 4, to: 11 })]));
    stop = startComments();
    await waitFor(() => expect(useComments.getState().threads).toHaveLength(1));
    const surface = noteSurface();
    expect(surface.show).toHaveBeenCalledWith(expect.objectContaining({ spans: [{ id: "t1", from: 4, to: 11, resolved: false }] }));
    act(() => useComments.setState({ status: commentsStatus({ projectEnabled: false }) }));
    expect(surface.show).toHaveBeenLastCalledWith({ spans: [], selected: null, draft: null });
  });

  it("creates a thread on the note's text as the editor has it now, after sending the person's typing", async () => {
    const surface = noteSurface({ draft: vi.fn(() => ({ from: 9, to: 14 })) });
    mocks.collabCommentCreate.mockResolvedValue(commentThread("t9", { from: 9, to: 14 }));
    stop = startComments();
    await waitFor(() => expect(useCommentsRail.getState().canCompose).toBe(true));
    act(() => useCommentsRail.setState({ request: { path: NOTE_PATH, from: 4, to: 9, quote: "masks" } }));
    expect(useComments.getState().draft).toMatchObject({ path: NOTE_PATH, from: 4, to: 9 });
    await waitFor(() => expect(surface.show).toHaveBeenLastCalledWith(expect.objectContaining({ draft: { from: 4, to: 9 } })));
    await act(() => createThread("Which ratio?"));
    expect(surface.flush).toHaveBeenCalled();
    expect(mocks.collabCommentCreate).toHaveBeenCalledWith(NOTE, NOTE_PATH, 9, 14, 7, "Which ratio?", expect.any(Array));
    expect(useComments.getState()).toMatchObject({ draft: null, selectedId: "t9" });
  });

  it("opens a thread clicked in the note and asks Notes to show its comments", async () => {
    mocks.collabCommentThreadList.mockResolvedValue(threadList([commentThread("t1", { from: 4, to: 11 })]));
    noteSurface();
    stop = startComments();
    await waitFor(() => expect(useComments.getState().threads).toHaveLength(1));
    const before = useNoteCommentsRequest.getState().count;
    act(() => openNoteComment("t1", "marker"));
    expect(useComments.getState().selectedId).toBe("t1");
    expect(useNoteCommentsRequest.getState().count).toBe(before + 1);
  });

  it("keeps a project file's threads when no note is the live project", async () => {
    useCollabLiveNote.setState({ noteId: null });
    useCollabLiveStore.setState({ projectId: "paper", share: shareInfo({ project_id: "paper", role: "editor", account_id: ALICE_ID }) });
    stop = startComments();
    await waitFor(() => expect(mocks.collabCommentThreadList).toHaveBeenCalledWith("paper", "intro.tex"));
  });
});
