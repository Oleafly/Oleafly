// @vitest-environment jsdom

import { act } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useCommentsRail } from "@/components/collab/comments-rail";
import { loadNamespace } from "@/i18n";
import type { CollabSuggestion, CollabSuggestionList, CollabSuggestionsChanged } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useComments } from "../comments/comments-store";
import { useCollabLiveStore } from "../live/live-store";
import { commentThread } from "../tests/comment-fixtures";
import { ALICE_ID, BOB, deferred, person, projectMember, shareInfo } from "../tests/fixtures";
import { suggestion, suggestionList, suggestionsChanged } from "../tests/suggestion-fixtures";

const mocks = vi.hoisted(() => ({
  collabSuggestionList: vi.fn(),
  collabSuggestionCounts: vi.fn(),
  collabSuggestionAcceptFile: vi.fn(),
  collabSuggestionRejectFile: vi.fn(),
  collabSuggestionReply: vi.fn(),
  collabCommentThreadList: vi.fn(),
  logError: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabSuggestionList: mocks.collabSuggestionList,
  collabSuggestionCounts: mocks.collabSuggestionCounts,
  collabSuggestionAcceptFile: mocks.collabSuggestionAcceptFile,
  collabSuggestionRejectFile: mocks.collabSuggestionRejectFile,
  collabSuggestionReply: mocks.collabSuggestionReply,
  collabCommentThreadList: mocks.collabCommentThreadList,
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

vi.mock("@/components/editor/cm/suggestions-slot", () => ({
  setSuggestionsEditorExtension: () => () => undefined,
}));

vi.mock("@/lib/toast", () => ({
  toast: { infoUnique: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import {
  acceptFile,
  collapseSuggestionsFile,
  expandSuggestionsFile,
  rejectFile,
  replyToSuggestion,
  startSuggestions,
  useSuggestions,
} from "./suggestions-store";

const MEMBERS = [projectMember(person(), "editor"), projectMember(BOB, "owner")];
const METHODS = "methods.tex";
const RELOAD_DELAY = 150;

let stop: (() => void) | null = null;

function method(id: string, from: number): CollabSuggestion {
  return suggestion(id, { fileId: "file-methods", from, to: from + 4, text: "very" });
}

function emit(payload: CollabSuggestionsChanged) {
  act(() => mocks.listeners.get("collab://suggestions-changed")?.({ payload }));
}

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function start() {
  stop = startSuggestions();
  await settle();
}

async function opened(path = METHODS) {
  await start();
  act(() => expandSuggestionsFile(path));
  await settle();
}

function section(path = METHODS) {
  return useSuggestions.getState().elsewhere[path];
}

function sectionIds(path = METHODS): string[] | undefined {
  return section(path)?.suggestions.map((entry) => entry.id);
}

function listedPaths(): string[] {
  return mocks.collabSuggestionList.mock.calls.map((call) => call[1] as string);
}

function listsBy(byPath: Record<string, () => Promise<CollabSuggestionList>>) {
  mocks.collabSuggestionList.mockImplementation((_project: string, path: string) =>
    (byPath[path] ?? (async () => suggestionList([])))(),
  );
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.resetAllMocks();
  mocks.listeners.clear();
  listsBy({
    "intro.tex": async () => suggestionList([suggestion("s1")]),
    [METHODS]: async () => suggestionList([method("m2", 9), method("m1", 2)]),
  });
  mocks.collabSuggestionCounts.mockResolvedValue([
    { path: "intro.tex", pending: 1 },
    { path: METHODS, pending: 2 },
  ]);
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
  vi.useRealTimers();
  useSuggestions.setState({ projectId: null, path: null, suggestions: [], elsewhere: {}, counts: null });
  useComments.setState({ projectId: null, threads: [], elsewhere: {} });
  useCollabLiveStore.setState({ projectId: null, share: null, role: null, status: null, members: [] });
  useCommentsRail.setState({ visible: false, suggestions: false, unread: false, canCompose: false });
});

describe("suggestions in other files", () => {
  it("loads another file's suggestions in document order when its section opens", async () => {
    await start();
    act(() => expandSuggestionsFile(METHODS));
    expect(section()).toEqual({ phase: "loading", suggestions: [], error: null });
    await settle();
    expect(section()).toMatchObject({ phase: "ready", error: null });
    expect(sectionIds()).toEqual(["m1", "m2"]);
    expect(mocks.collabSuggestionList).toHaveBeenCalledWith("paper", METHODS);
  });

  it("shows a section's suggestions at once when that file becomes the open one", async () => {
    await opened();
    const known = section()?.suggestions;
    const opening = deferred<CollabSuggestionList>();
    mocks.collabSuggestionList.mockReturnValueOnce(opening.promise);
    act(() => useFilesStore.setState({ activePath: METHODS }));
    expect(useSuggestions.getState()).toMatchObject({ path: METHODS, phase: "loading" });
    expect(useSuggestions.getState().suggestions).toBe(known);
    expect(section()).toBeUndefined();
    opening.resolve(suggestionList([method("m2", 9), method("m1", 2)]));
    await settle();
    expect(useSuggestions.getState().phase).toBe("ready");
    expect(useSuggestions.getState().suggestions).toBe(known);
  });

  it("refreshes an open section without redrawing it when nothing changed, and never makes the open file a section", async () => {
    await opened();
    const before = useSuggestions.getState();
    act(() => expandSuggestionsFile(METHODS));
    expect(useSuggestions.getState()).toBe(before);
    await settle();
    expect(useSuggestions.getState()).toBe(before);
    expect(listedPaths().filter((path) => path === METHODS)).toHaveLength(2);
    act(() => expandSuggestionsFile("intro.tex"));
    await settle();
    expect(useSuggestions.getState()).toBe(before);
    expect(listedPaths().filter((path) => path === "intro.tex")).toHaveLength(1);
  });

  it("shows a section that failed and keeps its suggestions while it tries again", async () => {
    await opened();
    mocks.collabSuggestionList.mockRejectedValueOnce({ code: "unreachable", message: "offline" });
    emit(suggestionsChanged({ paths: [METHODS] }));
    await settle(RELOAD_DELAY);
    expect(section()).toMatchObject({ phase: "failed", error: "unreachable" });
    expect(sectionIds()).toEqual(["m1", "m2"]);
    expect(mocks.logError).toHaveBeenCalledWith(
      "collab suggestions load",
      expect.objectContaining({ code: "unreachable" }),
    );
    mocks.collabSuggestionList.mockResolvedValueOnce(suggestionList([method("m1", 2), method("m3", 20)]));
    act(() => expandSuggestionsFile(METHODS));
    expect(section()).toMatchObject({ phase: "loading", error: null });
    expect(sectionIds()).toEqual(["m1", "m2"]);
    await settle();
    expect(section()).toMatchObject({ phase: "ready", error: null });
    expect(sectionIds()).toEqual(["m1", "m3"]);
  });

  it("treats a section the server no longer knows as empty, without logging it", async () => {
    listsBy({
      "intro.tex": async () => suggestionList([suggestion("s1")]),
      [METHODS]: async () => Promise.reject({ code: "not_found", message: "gone" }),
    });
    await opened();
    expect(section()).toEqual({ phase: "ready", error: null, suggestions: [] });
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("keeps a section closed when its list arrives after it was closed", async () => {
    await start();
    const late = deferred<CollabSuggestionList>();
    mocks.collabSuggestionList.mockReturnValueOnce(late.promise);
    act(() => expandSuggestionsFile(METHODS));
    act(() => collapseSuggestionsFile(METHODS));
    late.resolve(suggestionList([method("m1", 2)]));
    await settle();
    expect(section()).toBeUndefined();
  });

  it("shows only the newest answer when a section is opened again while it loads", async () => {
    await start();
    const answers = [
      deferred<CollabSuggestionList>(),
      deferred<CollabSuggestionList>(),
      deferred<CollabSuggestionList>(),
    ];
    for (const answer of answers) mocks.collabSuggestionList.mockReturnValueOnce(answer.promise);
    act(() => {
      expandSuggestionsFile(METHODS);
      expandSuggestionsFile(METHODS);
      expandSuggestionsFile(METHODS);
    });
    answers[2].resolve(suggestionList([method("m2", 9)]));
    await settle();
    answers[0].resolve(suggestionList([method("m1", 2)]));
    answers[1].reject({ code: "unreachable", message: "offline" });
    await settle();
    expect(section()).toMatchObject({ phase: "ready", error: null });
    expect(sectionIds()).toEqual(["m2"]);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("asks for nothing about other files before the project is shared", async () => {
    act(() => expandSuggestionsFile(METHODS));
    await settle();
    expect(mocks.collabSuggestionList).not.toHaveBeenCalled();
    act(() => collapseSuggestionsFile(METHODS));
    expect(section()).toBeUndefined();
    const before = useSuggestions.getState();
    act(() => collapseSuggestionsFile(METHODS));
    expect(useSuggestions.getState()).toBe(before);
  });

  it("reloads every open section for a change that names no file, and only the named one otherwise", async () => {
    await start();
    act(() => {
      expandSuggestionsFile(METHODS);
      expandSuggestionsFile("refs.tex");
    });
    await settle();
    mocks.collabSuggestionList.mockClear();
    emit(suggestionsChanged({ paths: [] }));
    await settle(RELOAD_DELAY);
    expect(listedPaths().sort()).toEqual(["intro.tex", METHODS, "refs.tex"]);
    mocks.collabSuggestionList.mockClear();
    emit(suggestionsChanged({ paths: [METHODS] }));
    await settle(RELOAD_DELAY);
    expect(listedPaths()).toEqual([METHODS]);
  });

  it("accepts a whole other file and drops only that file's suggestions", async () => {
    await opened();
    const here = useSuggestions.getState().suggestions;
    await act(() => acceptFile(METHODS));
    expect(mocks.collabSuggestionAcceptFile).toHaveBeenCalledWith("paper", METHODS);
    expect(sectionIds()).toEqual([]);
    expect(useSuggestions.getState().suggestions).toBe(here);
    await act(() => rejectFile("refs.tex"));
    expect(mocks.collabSuggestionRejectFile).toHaveBeenCalledWith("paper", "refs.tex");
    expect(useSuggestions.getState().suggestions).toBe(here);
  });

  it("starts a thread for a suggestion shown in another file's section", async () => {
    await opened();
    mocks.collabSuggestionReply.mockResolvedValue(commentThread("t-m1", { from: 2, to: 6 }, { fileId: "file-methods" }));
    const here = useSuggestions.getState().suggestions;
    const target = section()?.suggestions.find((entry) => entry.id === "m1");
    if (!target) throw new Error("missing suggestion");
    await act(() => replyToSuggestion(target, "Why here?"));
    expect(mocks.collabSuggestionReply).toHaveBeenCalledWith("paper", "m1", "Why here?", expect.any(Array));
    expect(section()?.suggestions.find((entry) => entry.id === "m1")?.threadId).toBe("t-m1");
    expect(useSuggestions.getState().suggestions).toBe(here);
  });

  it("asks the server to reply when a suggestion's thread isn't loaded in any file", async () => {
    await opened();
    act(() =>
      useComments.setState({
        threads: [commentThread("t-here", { from: 0, to: 3 })],
        elsewhere: {
          [METHODS]: { phase: "ready", error: null, threads: [commentThread("t-other", { from: 2, to: 6 })] },
        },
      }),
    );
    mocks.collabSuggestionReply.mockResolvedValue(commentThread("t-m1", { from: 2, to: 6 }, { fileId: "file-methods" }));
    const target = section()?.suggestions.find((entry) => entry.id === "m1");
    if (!target) throw new Error("missing suggestion");
    await act(() => replyToSuggestion({ ...target, threadId: "t-unloaded" }, "Still unsure."));
    expect(mocks.collabSuggestionReply).toHaveBeenCalledWith("paper", "m1", "Still unsure.", expect.any(Array));
    expect(section()?.suggestions.find((entry) => entry.id === "m1")?.threadId).toBe("t-m1");
  });
});
