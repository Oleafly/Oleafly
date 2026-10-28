// @vitest-environment jsdom

import { act } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useCommentsRail } from "@/components/collab/comments-rail";
import { loadNamespace } from "@/i18n";
import type { CollabSuggestionCount, CollabSuggestionList, CollabSuggestionsChanged } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "../live/live-store";
import { ALICE_ID, BOB, deferred, person, projectMember, shareInfo } from "../tests/fixtures";
import { suggestion, suggestionList, suggestionsChanged } from "../tests/suggestion-fixtures";

const mocks = vi.hoisted(() => ({
  collabSuggestionList: vi.fn(),
  collabSuggestionCounts: vi.fn(),
  collabSuggestionAccept: vi.fn(),
  collabSuggestionReject: vi.fn(),
  collabSuggestionAcceptFile: vi.fn(),
  collabCommentThreadList: vi.fn(),
  session: vi.fn((_path: string): unknown => null),
  logError: vi.fn(),
  listen: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabSuggestionList: mocks.collabSuggestionList,
  collabSuggestionCounts: mocks.collabSuggestionCounts,
  collabSuggestionAccept: mocks.collabSuggestionAccept,
  collabSuggestionReject: mocks.collabSuggestionReject,
  collabSuggestionAcceptFile: mocks.collabSuggestionAcceptFile,
  collabCommentThreadList: mocks.collabCommentThreadList,
}));

vi.mock("@/lib/collab-live-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collab-live-bridge")>()),
  collabDocumentSession: mocks.session,
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

vi.mock("@/components/editor/cm/suggestions-slot", () => ({
  setSuggestionsEditorExtension: () => () => undefined,
}));

vi.mock("@/lib/toast", () => ({
  toast: { infoUnique: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import {
  acceptFile,
  acceptSuggestions,
  hoverSuggestion,
  rejectSuggestions,
  reloadSuggestions,
  selectSuggestion,
  startSuggestions,
  useSuggestions,
} from "./suggestions-store";

const MEMBERS = [projectMember(person(), "editor"), projectMember(BOB, "owner")];
const RELOAD_DELAY = 150;

let stop: (() => void) | null = null;

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

function ids(): string[] {
  return useSuggestions.getState().suggestions.map((entry) => entry.id);
}

function listedPaths(): string[] {
  return mocks.collabSuggestionList.mock.calls.map((call) => call[1] as string);
}

function listsBy(byPath: Record<string, () => Promise<CollabSuggestionList>>) {
  mocks.collabSuggestionList.mockImplementation((_project: string, path: string) =>
    (byPath[path] ?? (async () => suggestionList([])))(),
  );
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
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.resetAllMocks();
  mocks.listeners.clear();
  mocks.listen.mockImplementation(async (event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(event, handler);
    return () => mocks.listeners.delete(event);
  });
  mocks.session.mockReturnValue(null);
  mocks.collabSuggestionList.mockResolvedValue(
    suggestionList([suggestion("s1"), suggestion("s2", { from: 1, to: 2 })]),
  );
  mocks.collabSuggestionCounts.mockResolvedValue([{ path: "intro.tex", pending: 2 }]);
  mocks.collabSuggestionAccept.mockResolvedValue(undefined);
  mocks.collabSuggestionReject.mockResolvedValue(undefined);
  mocks.collabSuggestionAcceptFile.mockResolvedValue(undefined);
  mocks.collabCommentThreadList.mockResolvedValue({ rev: null, threads: [] });
  useSettingsStore.setState({ railTab: "files", showTree: true });
  useFilesStore.setState({ projectId: "paper", activePath: "intro.tex" });
  useCollabLiveStore.setState({
    projectId: "paper",
    share: shareInfo({ project_id: "paper", role: "editor", account_id: ALICE_ID }),
    role: "editor",
    status: { state: "online" },
    pending: 0,
    members: MEMBERS,
  });
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  useCollabLiveStore.setState({ projectId: null, share: null, role: null, status: null, members: [] });
  useCommentsRail.setState({ visible: false, suggestions: false, unread: false, canCompose: false });
});

describe("loading the open file's suggestions", () => {
  it("shows why the list failed and loads it again on the next change", async () => {
    mocks.collabSuggestionList.mockRejectedValueOnce({ code: "unreachable", message: "offline" });
    await start();
    expect(useSuggestions.getState()).toMatchObject({
      path: "intro.tex",
      phase: "failed",
      error: "unreachable",
      suggestions: [],
    });
    expect(mocks.logError).toHaveBeenCalledWith(
      "collab suggestions load",
      expect.objectContaining({ code: "unreachable" }),
    );
    const retry = deferred<CollabSuggestionList>();
    mocks.collabSuggestionList.mockReturnValueOnce(retry.promise);
    emit(suggestionsChanged());
    expect(useSuggestions.getState().phase).toBe("failed");
    await settle(RELOAD_DELAY);
    expect(useSuggestions.getState()).toMatchObject({ phase: "loading", error: null });
    retry.resolve(suggestionList([suggestion("s1")]));
    await settle();
    expect(useSuggestions.getState()).toMatchObject({ phase: "ready", error: null });
    expect(ids()).toEqual(["s1"]);
  });

  it("tries the open file again when the person asks after a failure", async () => {
    mocks.collabSuggestionList.mockRejectedValueOnce({ code: "server", message: "boom" });
    await start();
    expect(useSuggestions.getState()).toMatchObject({ phase: "failed", error: "server" });
    act(() => reloadSuggestions());
    expect(useSuggestions.getState()).toMatchObject({ phase: "loading", error: null });
    await settle();
    expect(useSuggestions.getState()).toMatchObject({ phase: "ready", error: null });
    expect(ids()).toEqual(["s2", "s1"]);
  });

  it("shows a file the server has no record of as having nothing to review, without logging it", async () => {
    mocks.collabSuggestionList.mockRejectedValue({ code: "not_found", message: "gone" });
    mocks.collabSuggestionCounts.mockRejectedValue({ code: "not_found", message: "gone" });
    await start();
    expect(useSuggestions.getState()).toMatchObject({ phase: "ready", error: null, suggestions: [], counts: [] });
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("ignores a list that arrives after the person opened another file", async () => {
    const late = deferred<CollabSuggestionList>();
    listsBy({
      "intro.tex": () => late.promise,
      "methods.tex": async () => suggestionList([suggestion("m1", { fileId: "file-methods" })]),
    });
    await start();
    expect(useSuggestions.getState()).toMatchObject({ path: "intro.tex", phase: "loading" });
    act(() => useFilesStore.setState({ activePath: "methods.tex" }));
    await settle();
    late.resolve(suggestionList([suggestion("s1")]));
    await settle();
    expect(useSuggestions.getState()).toMatchObject({ path: "methods.tex", phase: "ready" });
    expect(ids()).toEqual(["m1"]);
  });

  it("ignores a failure that arrives after the person opened another file", async () => {
    const late = deferred<CollabSuggestionList>();
    listsBy({
      "intro.tex": () => late.promise,
      "methods.tex": async () => suggestionList([suggestion("m1", { fileId: "file-methods" })]),
    });
    await start();
    act(() => useFilesStore.setState({ activePath: "methods.tex" }));
    await settle();
    late.reject({ code: "unreachable", message: "offline" });
    await settle();
    expect(useSuggestions.getState()).toMatchObject({ path: "methods.tex", phase: "ready", error: null });
    expect(ids()).toEqual(["m1"]);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("asks again while the list is older than the editor's text and never shows the old one", async () => {
    const session = fakeSession(5);
    mocks.session.mockImplementation((path: string) => (path === "intro.tex" ? session : null));
    mocks.collabSuggestionList
      .mockResolvedValueOnce(suggestionList([suggestion("old")], 4))
      .mockResolvedValue(suggestionList([suggestion("new")], 5));
    const shown: string[] = [];
    const unsubscribe = useSuggestions.subscribe((state) =>
      shown.push(...state.suggestions.map((entry) => entry.id)),
    );
    await start();
    unsubscribe();
    expect(ids()).toEqual(["new"]);
    expect(shown).not.toContain("old");
    expect(mocks.collabSuggestionList).toHaveBeenCalledTimes(2);
  });

  it("shows the fifth list when the editor never catches up", async () => {
    mocks.session.mockReturnValue(fakeSession(9));
    mocks.collabSuggestionList.mockResolvedValue(suggestionList([suggestion("late")], 8));
    await start();
    expect(ids()).toEqual(["late"]);
    expect(mocks.collabSuggestionList).toHaveBeenCalledTimes(5);
  });

  it("waits for the editor to catch up with a list made from newer text", async () => {
    const session = fakeSession(5);
    mocks.session.mockReturnValue(session);
    mocks.collabSuggestionList.mockResolvedValue(suggestionList([suggestion("ahead")], 6));
    await start();
    expect(useSuggestions.getState().phase).toBe("loading");
    expect(mocks.collabSuggestionList).toHaveBeenCalledTimes(1);
    act(() => session.catchUp(6));
    await settle();
    expect(ids()).toEqual(["ahead"]);
    expect(mocks.collabSuggestionList).toHaveBeenCalledTimes(2);
  });

  it("drops a list whose wait for the editor ends after the person opened another file", async () => {
    const session = fakeSession(5, false);
    mocks.session.mockImplementation((path: string) => (path === "intro.tex" ? session : null));
    listsBy({
      "intro.tex": async () => suggestionList([suggestion("typing")], 5),
      "methods.tex": async () => suggestionList([suggestion("m1", { fileId: "file-methods" })]),
    });
    await start();
    expect(session.settled).toHaveBeenCalled();
    act(() => useFilesStore.setState({ activePath: "methods.tex" }));
    await settle();
    act(() => session.finishTyping(6));
    await settle();
    expect(useSuggestions.getState()).toMatchObject({ path: "methods.tex", phase: "ready" });
    expect(ids()).toEqual(["m1"]);
    expect(listedPaths()).toEqual(["intro.tex", "methods.tex"]);
  });

  it("keeps the selection and hover on suggestions that are still there after a reload", async () => {
    await start();
    act(() => {
      selectSuggestion("s1");
      hoverSuggestion("s2");
    });
    emit(suggestionsChanged());
    await settle(RELOAD_DELAY);
    expect(useSuggestions.getState()).toMatchObject({ selectedId: "s1", hoveredId: "s2" });
    await act(() => rejectSuggestions(["s2"]));
    expect(useSuggestions.getState().selectedId).toBe("s1");
    expect(ids()).toEqual(["s1"]);
    mocks.collabSuggestionList.mockResolvedValue(suggestionList([suggestion("s3")]));
    emit(suggestionsChanged());
    await settle(RELOAD_DELAY);
    expect(useSuggestions.getState()).toMatchObject({ selectedId: null, hoveredId: null });
    expect(ids()).toEqual(["s3"]);
  });
});

describe("reacting to changes", () => {
  it("reloads once for a burst of changes", async () => {
    await start();
    emit(suggestionsChanged());
    await settle(RELOAD_DELAY - 50);
    emit(suggestionsChanged());
    await settle(RELOAD_DELAY - 50);
    expect(mocks.collabSuggestionList).toHaveBeenCalledTimes(1);
    expect(mocks.collabSuggestionCounts).toHaveBeenCalledTimes(1);
    await settle(50);
    expect(mocks.collabSuggestionList).toHaveBeenCalledTimes(2);
    expect(mocks.collabSuggestionCounts).toHaveBeenCalledTimes(2);
  });

  it("drops a waiting reload when the project stops being shared", async () => {
    await start();
    expect(useCommentsRail.getState().suggestions).toBe(true);
    emit(suggestionsChanged());
    act(() => useCollabLiveStore.setState({ share: null }));
    expect(useSuggestions.getState()).toMatchObject({
      projectId: null,
      path: null,
      phase: "idle",
      suggestions: [],
      counts: null,
    });
    expect(useCommentsRail.getState().suggestions).toBe(false);
    await settle(RELOAD_DELAY);
    expect(mocks.collabSuggestionList).toHaveBeenCalledTimes(1);
    expect(mocks.collabSuggestionCounts).toHaveBeenCalledTimes(1);
  });

  it("loads again when the connection comes back or the role changes, and not for other live updates", async () => {
    await start();
    act(() => useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 1_000 } }));
    act(() => useCollabLiveStore.setState({ pending: 2 }));
    await settle();
    expect(mocks.collabSuggestionList).toHaveBeenCalledTimes(1);
    act(() => useCollabLiveStore.setState({ status: { state: "online" } }));
    await settle();
    expect(mocks.collabSuggestionList).toHaveBeenCalledTimes(2);
    expect(mocks.collabSuggestionCounts).toHaveBeenCalledTimes(2);
    act(() => useCollabLiveStore.setState({ role: "reviewer" }));
    await settle();
    expect(mocks.collabSuggestionList).toHaveBeenCalledTimes(3);
    act(() => useCollabLiveStore.setState({ role: null }));
    await settle();
    expect(mocks.collabSuggestionList).toHaveBeenCalledTimes(3);
  });

  it("follows the open file only while the project is live and open in this window", async () => {
    await start();
    act(() => useFilesStore.setState({}));
    act(() => useCollabLiveStore.setState({ role: null }));
    act(() => useFilesStore.setState({ activePath: "methods.tex" }));
    await settle();
    expect(listedPaths()).toEqual(["intro.tex"]);
    act(() => useCollabLiveStore.setState({ role: "editor" }));
    await settle();
    expect(useSuggestions.getState().path).toBe("methods.tex");
    act(() => useFilesStore.setState({ projectId: "other" }));
    await settle();
    expect(useSuggestions.getState()).toMatchObject({ path: null, phase: "idle", suggestions: [], selectedId: null });
    expect(listedPaths()).toEqual(["intro.tex", "methods.tex"]);
  });

  it("still loads, and stops cleanly, when change events can't be listened for", async () => {
    mocks.listen.mockRejectedValueOnce(new Error("no event bridge"));
    await start();
    expect(mocks.logError).toHaveBeenCalledWith("collab suggestions listen", expect.any(Error));
    expect(ids()).toEqual(["s2", "s1"]);
    stop?.();
    stop = null;
    await settle();
    expect(useSuggestions.getState()).toMatchObject({ projectId: null, suggestions: [] });
  });

  it("marks the Comments tab unread only while it is out of sight", async () => {
    useSettingsStore.setState({ railTab: "comments", showTree: true });
    await start();
    emit(suggestionsChanged());
    expect(useCommentsRail.getState().unread).toBe(false);
    act(() => useSettingsStore.setState({ showTree: false }));
    emit(suggestionsChanged());
    expect(useCommentsRail.getState().unread).toBe(true);
    const rail = useCommentsRail.getState();
    emit(suggestionsChanged());
    expect(useCommentsRail.getState()).toBe(rail);
  });
});

describe("counting what waits", () => {
  it("keeps the counts it had when a later count fails, and logs why", async () => {
    await start();
    mocks.collabSuggestionCounts.mockRejectedValueOnce({ code: "server", message: "boom" });
    emit(suggestionsChanged());
    await settle(RELOAD_DELAY);
    expect(useSuggestions.getState().counts).toEqual([{ path: "intro.tex", pending: 2 }]);
    expect(mocks.logError).toHaveBeenCalledWith("collab suggestion counts", expect.objectContaining({ code: "server" }));
  });

  it("keeps the newest counts when an older request answers last", async () => {
    const first = deferred<CollabSuggestionCount[]>();
    mocks.collabSuggestionCounts
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue([{ path: "intro.tex", pending: 1 }]);
    await start();
    expect(useSuggestions.getState().counts).toBeNull();
    emit(suggestionsChanged({ paths: ["methods.tex"] }));
    await settle(RELOAD_DELAY);
    expect(useSuggestions.getState().counts).toEqual([{ path: "intro.tex", pending: 1 }]);
    first.resolve([{ path: "intro.tex", pending: 7 }]);
    await settle();
    expect(useSuggestions.getState().counts).toEqual([{ path: "intro.tex", pending: 1 }]);
  });

  it("ignores an older count request that fails after a newer one answered", async () => {
    const first = deferred<CollabSuggestionCount[]>();
    mocks.collabSuggestionCounts
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue([{ path: "intro.tex", pending: 1 }]);
    await start();
    emit(suggestionsChanged({ paths: ["methods.tex"] }));
    await settle(RELOAD_DELAY);
    first.reject({ code: "server", message: "boom" });
    await settle();
    expect(useSuggestions.getState().counts).toEqual([{ path: "intro.tex", pending: 1 }]);
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});

describe("deciding on suggestions", () => {
  it("refuses to decide while the project isn't shared and sends nothing for an empty pick", async () => {
    await expect(acceptSuggestions(["s1"])).rejects.toThrow("This project is not shared.");
    await expect(acceptFile("intro.tex")).rejects.toThrow("This project is not shared.");
    await start();
    await act(() => acceptSuggestions([]));
    expect(mocks.collabSuggestionAccept).not.toHaveBeenCalled();
    expect(mocks.collabSuggestionAcceptFile).not.toHaveBeenCalled();
    expect(ids()).toEqual(["s2", "s1"]);
  });

  it("leaves the cleared list alone when an accept finishes after sharing stopped", async () => {
    await start();
    const accepting = deferred<void>();
    mocks.collabSuggestionAccept.mockReturnValueOnce(accepting.promise);
    const pending = acceptSuggestions(["s1"]);
    act(() => useCollabLiveStore.setState({ share: null }));
    accepting.resolve();
    await act(() => pending);
    expect(mocks.collabSuggestionAccept).toHaveBeenCalledWith("paper", ["s1"]);
    expect(useSuggestions.getState()).toMatchObject({ projectId: null, suggestions: [], counts: null });
    expect(mocks.collabSuggestionCounts).toHaveBeenCalledTimes(1);
  });
});
