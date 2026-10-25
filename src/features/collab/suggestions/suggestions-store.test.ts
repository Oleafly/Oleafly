// @vitest-environment jsdom

import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useCommentsRail } from "@/components/collab/comments-rail";
import { noteUnreviewedSuggestions } from "@/lib/collab-live-bridge";
import type { CollabSuggestion, CollabSuggestionsChanged } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useComments } from "../comments/comments-store";
import { useCollabLiveStore } from "../live/live-store";
import { ALICE_ID, BOB, BOB_ID, fill, person, projectMember, shareInfo } from "../tests/fixtures";
import { commentThread } from "../tests/comment-fixtures";

const mocks = vi.hoisted(() => ({
  collabSuggestionList: vi.fn(),
  collabSuggestionCounts: vi.fn(),
  collabSuggestionAccept: vi.fn(),
  collabSuggestionReject: vi.fn(),
  collabSuggestionWithdraw: vi.fn(),
  collabSuggestionAcceptFile: vi.fn(),
  collabSuggestionRejectFile: vi.fn(),
  collabSuggestionReply: vi.fn(),
  collabCommentReply: vi.fn(),
  collabCommentThreadList: vi.fn(),
  infoUnique: vi.fn(),
  installed: vi.fn(),
  released: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabSuggestionList: mocks.collabSuggestionList,
  collabSuggestionCounts: mocks.collabSuggestionCounts,
  collabSuggestionAccept: mocks.collabSuggestionAccept,
  collabSuggestionReject: mocks.collabSuggestionReject,
  collabSuggestionWithdraw: mocks.collabSuggestionWithdraw,
  collabSuggestionAcceptFile: mocks.collabSuggestionAcceptFile,
  collabSuggestionRejectFile: mocks.collabSuggestionRejectFile,
  collabSuggestionReply: mocks.collabSuggestionReply,
  collabCommentReply: mocks.collabCommentReply,
  collabCommentThreadList: mocks.collabCommentThreadList,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(event, handler);
    return () => mocks.listeners.delete(event);
  }),
}));

vi.mock("@/components/editor/cm/suggestions-slot", () => ({
  setSuggestionsEditorExtension: (extension: unknown) => {
    mocks.installed(extension);
    return mocks.released;
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: { infoUnique: mocks.infoUnique, info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import {
  acceptFile,
  acceptSuggestions,
  openSuggestionFromEditor,
  rejectFile,
  rejectSuggestions,
  replyToSuggestion,
  startSuggestions,
  useSuggestions,
  withdrawSuggestions,
} from "./suggestions-store";

const AT = 1_760_000_000_000;
const MEMBERS = [projectMember(person(), "editor"), projectMember(BOB, "owner")];

function suggestion(id: string, overrides: Partial<CollabSuggestion> = {}): CollabSuggestion {
  return {
    id,
    fileId: "file-intro",
    kind: "insert",
    author: BOB_ID,
    createdAt: AT,
    from: 4,
    to: 10,
    text: "quick ",
    threadId: null,
    verified: true,
    ...overrides,
  };
}

let stop: (() => void) | null = null;

function emit(event: string, payload: unknown) {
  act(() => mocks.listeners.get(event)?.({ payload }));
}

function changed(overrides: Partial<CollabSuggestionsChanged> = {}): CollabSuggestionsChanged {
  return { projectId: "paper", paths: ["intro.tex"], local: false, ...overrides };
}

function ids(): string[] {
  return useSuggestions.getState().suggestions.map((entry) => entry.id);
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.collabSuggestionList.mockResolvedValue({ rev: null, suggestions: [suggestion("s1"), suggestion("s2", { from: 1, to: 2 })] });
  mocks.collabSuggestionCounts.mockResolvedValue([{ path: "intro.tex", pending: 2 }]);
  mocks.collabSuggestionAccept.mockResolvedValue(undefined);
  mocks.collabSuggestionReject.mockResolvedValue(undefined);
  mocks.collabSuggestionWithdraw.mockResolvedValue(undefined);
  mocks.collabSuggestionAcceptFile.mockResolvedValue(undefined);
  mocks.collabSuggestionRejectFile.mockResolvedValue(undefined);
  mocks.collabCommentThreadList.mockResolvedValue({ rev: null, threads: [] });
  useSettingsStore.setState({ railTab: "files", showTree: true });
  useFilesStore.setState({ projectId: "paper", activePath: "intro.tex" });
  useCollabLiveStore.setState({
    projectId: "paper",
    share: shareInfo({ project_id: "paper", role: "editor", account_id: ALICE_ID }),
    role: "editor",
    status: { state: "online" },
    members: MEMBERS,
  });
});

afterEach(() => {
  stop?.();
  stop = null;
  useCollabLiveStore.setState({ projectId: null, share: null, role: null, status: null, members: [] });
  useCommentsRail.setState({ visible: false, suggestions: false, unread: false, canCompose: false });
  useComments.setState({ projectId: null, threads: [], elsewhere: {} });
});

async function started() {
  stop = startSuggestions();
  await waitFor(() => expect(ids()).toEqual(["s2", "s1"]));
  await waitFor(() => expect(useSuggestions.getState().counts).toEqual([{ path: "intro.tex", pending: 2 }]));
}

describe("suggestions for a shared project", () => {
  it("lists the open file's suggestions in document order and shows the Comments tab while any wait", async () => {
    await started();
    expect(mocks.collabSuggestionList).toHaveBeenCalledWith("paper", "intro.tex");
    expect(mocks.installed).toHaveBeenCalledTimes(1);
    expect(useCommentsRail.getState().suggestions).toBe(true);
    mocks.collabSuggestionCounts.mockResolvedValue([]);
    await act(() => acceptSuggestions(["s1", "s2"]));
    expect(mocks.collabSuggestionAccept).toHaveBeenCalledWith("paper", ["s1", "s2"]);
    expect(ids()).toEqual([]);
    await waitFor(() => expect(useCommentsRail.getState().suggestions).toBe(false));
  });

  it("loads nothing for a project that isn't shared", async () => {
    useCollabLiveStore.setState({ share: null, role: null });
    stop = startSuggestions();
    await act(async () => undefined);
    expect(mocks.collabSuggestionList).not.toHaveBeenCalled();
    expect(useSuggestions.getState().projectId).toBeNull();
  });

  it("sends reject and withdraw with the suggestion ids and drops them here at once", async () => {
    await started();
    await act(() => rejectSuggestions(["s1"]));
    expect(mocks.collabSuggestionReject).toHaveBeenCalledWith("paper", ["s1"]);
    expect(ids()).toEqual(["s2"]);
    await act(() => withdrawSuggestions(["s2"]));
    expect(mocks.collabSuggestionWithdraw).toHaveBeenCalledWith("paper", ["s2"]);
    expect(ids()).toEqual([]);
  });

  it("accepts or rejects a whole file by its path", async () => {
    await started();
    await act(() => acceptFile("intro.tex"));
    expect(mocks.collabSuggestionAcceptFile).toHaveBeenCalledWith("paper", "intro.tex");
    expect(ids()).toEqual([]);
    mocks.collabSuggestionList.mockResolvedValue({ rev: null, suggestions: [suggestion("s3")] });
    emit("collab://suggestions-changed", changed({ local: true }));
    await waitFor(() => expect(ids()).toEqual(["s3"]));
    await act(() => rejectFile("intro.tex"));
    expect(mocks.collabSuggestionRejectFile).toHaveBeenCalledWith("paper", "intro.tex");
    expect(ids()).toEqual([]);
  });

  it("keeps the list here when a refusal comes back", async () => {
    await started();
    mocks.collabSuggestionAccept.mockRejectedValue({ code: "suggestion_role", message: "no" });
    await expect(acceptSuggestions(["s1"])).rejects.toMatchObject({ code: "suggestion_role" });
    expect(ids()).toEqual(["s2", "s1"]);
  });

  it("reloads after someone else's suggestion and marks the Comments tab while it is closed", async () => {
    await started();
    mocks.collabSuggestionList.mockResolvedValue({ rev: null, suggestions: [suggestion("s1")] });
    emit("collab://suggestions-changed", changed());
    await waitFor(() => expect(ids()).toEqual(["s1"]));
    expect(useCommentsRail.getState().unread).toBe(true);
    emit("collab://suggestions-changed", changed({ projectId: "other" }));
    expect(mocks.collabSuggestionList).toHaveBeenCalledTimes(2);
  });

  it("follows the open file", async () => {
    await started();
    mocks.collabSuggestionList.mockResolvedValue({ rev: null, suggestions: [] });
    act(() => useFilesStore.setState({ activePath: "methods.tex" }));
    await waitFor(() => expect(useSuggestions.getState().path).toBe("methods.tex"));
    expect(mocks.collabSuggestionList).toHaveBeenLastCalledWith("paper", "methods.tex");
  });

  it("tells the person once per count when they compile or export with suggestions waiting", async () => {
    await started();
    noteUnreviewedSuggestions("paper", "compile");
    noteUnreviewedSuggestions("paper", "compile");
    expect(mocks.infoUnique).toHaveBeenCalledTimes(1);
    expect(mocks.infoUnique).toHaveBeenLastCalledWith(
      expect.any(String),
      fill(enCollab.suggestions.pendingCompile, { number: "2" }),
    );
    noteUnreviewedSuggestions("paper", "export");
    expect(mocks.infoUnique).toHaveBeenLastCalledWith(
      expect.any(String),
      fill(enCollab.suggestions.pendingExport, { number: "2" }),
    );
    act(() => useSuggestions.setState({ counts: [{ path: "intro.tex", pending: 3 }] }));
    noteUnreviewedSuggestions("paper", "compile");
    expect(mocks.infoUnique).toHaveBeenCalledTimes(3);
    act(() => useSuggestions.setState({ counts: [] }));
    noteUnreviewedSuggestions("paper", "compile");
    noteUnreviewedSuggestions("other", "compile");
    expect(mocks.infoUnique).toHaveBeenCalledTimes(3);
  });

  it("says nothing on compile once it has stopped", async () => {
    await started();
    stop?.();
    stop = null;
    noteUnreviewedSuggestions("paper", "compile");
    expect(mocks.infoUnique).not.toHaveBeenCalled();
    expect(mocks.released).toHaveBeenCalledTimes(1);
  });

  it("starts a thread on the first reply and links it, then replies in that thread", async () => {
    await started();
    const created = commentThread("t-new", { from: 4, to: 10 });
    mocks.collabSuggestionReply.mockResolvedValue(created);
    const first = useSuggestions.getState().suggestions.find((entry) => entry.id === "s1");
    if (!first) throw new Error("missing suggestion");
    await act(() => replyToSuggestion(first, "Why this word?"));
    expect(mocks.collabSuggestionReply).toHaveBeenCalledWith("paper", "s1", "Why this word?", expect.any(Array));
    const linked = useSuggestions.getState().suggestions.find((entry) => entry.id === "s1");
    expect(linked?.threadId).toBe("t-new");
    act(() => useComments.setState({ projectId: "paper", threads: [created] }));
    mocks.collabCommentReply.mockResolvedValue({ ...created.messages[0], id: "m2", body: "Because." });
    if (!linked) throw new Error("missing link");
    await act(() => replyToSuggestion(linked, "Because."));
    expect(mocks.collabCommentReply).toHaveBeenCalledWith("paper", "file-intro", "t-new", "Because.", expect.any(Array));
    expect(mocks.collabSuggestionReply).toHaveBeenCalledTimes(1);
  });

  it("selects a suggestion clicked in the editor and brings the Comments tab forward", async () => {
    await started();
    openSuggestionFromEditor("s1");
    expect(useSuggestions.getState().selectedId).toBe("s1");
    expect(useSettingsStore.getState().railTab).toBe("comments");
  });
});
