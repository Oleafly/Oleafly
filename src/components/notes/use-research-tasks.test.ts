// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeTask, type ResearchTask } from "@/lib/research-tasks";
import { deferred } from "./tests/notes-data-fixture";

const mocks = vi.hoisted(() => ({
  listResearchTasks: vi.fn(),
  listenForResearchTaskChanges: vi.fn(),
  logError: vi.fn(),
  onTask: null as null | ((task: ResearchTask) => void),
  unlisten: vi.fn(),
}));

vi.mock("@/lib/research-tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/research-tasks")>()),
  listResearchTasks: mocks.listResearchTasks,
  listenForResearchTaskChanges: mocks.listenForResearchTaskChanges,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

const { useResearchTasks } = await import("./use-research-tasks");

function task(id: string, projectId: string, title = id, updatedAt = 0): ResearchTask {
  return normalizeTask({ id, projectId, status: "completed", title, updatedAt });
}

function ids(map: ReadonlyMap<string, readonly ResearchTask[]>) {
  return Object.fromEntries([...map].map(([key, list]) => [key, list.map((item) => item.id)]));
}

function titles(map: ReadonlyMap<string, readonly ResearchTask[]>) {
  return Object.fromEntries([...map].map(([key, list]) => [key, list.map((item) => item.title)]));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onTask = null;
  mocks.listResearchTasks.mockImplementation((projectId: string) => Promise.resolve([task(`${projectId}-1`, projectId)]));
  mocks.listenForResearchTaskChanges.mockImplementation((onTask: (task: ResearchTask) => void) => {
    mocks.onTask = onTask;
    return Promise.resolve(mocks.unlisten);
  });
});

describe("useResearchTasks", () => {
  it("starts empty and stays empty without projects", async () => {
    const { result } = renderHook(() => useResearchTasks([]));
    expect(result.current.size).toBe(0);
    await waitFor(() => expect(mocks.listenForResearchTaskChanges).toHaveBeenCalledOnce());
    expect(mocks.listResearchTasks).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });

  it("loads the tasks of each project", async () => {
    const { result } = renderHook(() => useResearchTasks(["b", "a"]));
    expect(result.current.size).toBe(0);
    await waitFor(() => expect(ids(result.current)).toEqual({ a: ["a-1"], b: ["b-1"] }));
    expect(mocks.listResearchTasks.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("loads again only when the set of projects changes", async () => {
    const { result, rerender } = renderHook(({ projects }) => useResearchTasks(projects), {
      initialProps: { projects: ["a", "b"] },
    });
    await waitFor(() => expect(result.current.size).toBe(2));
    rerender({ projects: ["b", "a", "a"] });
    expect(mocks.listResearchTasks).toHaveBeenCalledTimes(2);
    rerender({ projects: ["a", "c"] });
    await waitFor(() => expect(ids(result.current)).toEqual({ a: ["a-1"], c: ["c-1"] }));
    expect(mocks.listResearchTasks.mock.calls).toEqual([["a"], ["b"], ["a"], ["c"]]);
  });

  it("ignores a list that arrives after the projects changed", async () => {
    const slow = deferred<ResearchTask[]>();
    mocks.listResearchTasks.mockImplementation((projectId: string) =>
      projectId === "a" ? slow.promise : Promise.resolve([task(`${projectId}-1`, projectId)]),
    );
    const { result, rerender } = renderHook(({ projects }) => useResearchTasks(projects), {
      initialProps: { projects: ["a"] },
    });
    rerender({ projects: ["b"] });
    await waitFor(() => expect(ids(result.current)).toEqual({ b: ["b-1"] }));
    await act(async () => slow.resolve([task("a-1", "a")]));
    expect(ids(result.current)).toEqual({ b: ["b-1"] });
  });

  it("ignores a list that arrives after unmount", async () => {
    const slow = deferred<ResearchTask[]>();
    mocks.listResearchTasks.mockReturnValue(slow.promise);
    const { result, unmount } = renderHook(() => useResearchTasks(["a"]));
    unmount();
    await act(async () => slow.resolve([task("a-1", "a")]));
    expect(result.current.size).toBe(0);
  });

  it("logs a project whose tasks fail to load and keeps it empty", async () => {
    const failure = new Error("no tasks");
    mocks.listResearchTasks.mockImplementation((projectId: string) =>
      projectId === "a" ? Promise.reject(failure) : Promise.resolve([task("b-1", "b")]),
    );
    const { result } = renderHook(() => useResearchTasks(["a", "b"]));
    await waitFor(() => expect(ids(result.current)).toEqual({ a: [], b: ["b-1"] }));
    expect(mocks.logError).toHaveBeenCalledWith("list research tasks for notes", failure);
  });

  it("merges changed tasks into projects it tracks, newest first", async () => {
    mocks.listResearchTasks.mockResolvedValue([task("t1", "a"), task("t2", "a")]);
    const { result } = renderHook(() => useResearchTasks(["a"]));
    await waitFor(() => expect(ids(result.current)).toEqual({ a: ["t1", "t2"] }));
    await waitFor(() => expect(mocks.onTask).not.toBeNull());
    act(() => mocks.onTask?.(task("t3", "a")));
    expect(ids(result.current)).toEqual({ a: ["t3", "t1", "t2"] });
    act(() => mocks.onTask?.(task("t2", "a", "renamed")));
    expect(ids(result.current)).toEqual({ a: ["t2", "t3", "t1"] });
    expect(result.current.get("a")?.[0].title).toBe("renamed");
    const before = result.current;
    act(() => mocks.onTask?.(task("z1", "z")));
    expect(result.current).toBe(before);
  });

  it("keeps a change that arrives before the project's list loads", async () => {
    const slow = deferred<ResearchTask[]>();
    mocks.listResearchTasks.mockReturnValue(slow.promise);
    const { result } = renderHook(() => useResearchTasks(["a"]));
    expect(mocks.onTask).not.toBeNull();
    act(() => mocks.onTask?.(task("t1", "a", "from event", 5)));
    expect(result.current.size).toBe(0);
    await act(async () => slow.resolve([task("t1", "a", "listed", 1), task("t2", "a", "other", 1)]));
    expect(titles(result.current)).toEqual({ a: ["from event", "other"] });
  });

  it("prefers a change as new as the listed copy", async () => {
    const slow = deferred<ResearchTask[]>();
    mocks.listResearchTasks.mockReturnValue(slow.promise);
    const { result } = renderHook(() => useResearchTasks(["a"]));
    act(() => mocks.onTask?.(task("t1", "a", "from event", 3)));
    await act(async () => slow.resolve([task("t1", "a", "listed", 3)]));
    expect(titles(result.current)).toEqual({ a: ["from event"] });
  });

  it("keeps the listed copy over an older change", async () => {
    const slow = deferred<ResearchTask[]>();
    mocks.listResearchTasks.mockReturnValue(slow.promise);
    const { result } = renderHook(() => useResearchTasks(["a"]));
    act(() => mocks.onTask?.(task("t1", "a", "from event", 1)));
    await act(async () => slow.resolve([task("t1", "a", "listed", 5)]));
    expect(titles(result.current)).toEqual({ a: ["listed"] });
  });

  it("puts a task first that only a change has told about", async () => {
    const slow = deferred<ResearchTask[]>();
    mocks.listResearchTasks.mockReturnValue(slow.promise);
    const { result } = renderHook(() => useResearchTasks(["a"]));
    act(() => mocks.onTask?.(task("t9", "a", "new", 9)));
    act(() => mocks.onTask?.(task("b9", "b", "other project", 9)));
    await act(async () => slow.resolve([task("t1", "a"), task("t2", "a")]));
    expect(ids(result.current)).toEqual({ a: ["t9", "t1", "t2"] });
  });

  it("applies changes it saw earlier when another project starts loading", async () => {
    const { result, rerender } = renderHook(({ projects }) => useResearchTasks(projects), {
      initialProps: { projects: ["a"] },
    });
    await waitFor(() => expect(ids(result.current)).toEqual({ a: ["a-1"] }));
    act(() => mocks.onTask?.(task("b-2", "b", "seen early", 4)));
    act(() => mocks.onTask?.(task("a-1", "a", "renamed", 2)));
    rerender({ projects: ["a", "b"] });
    await waitFor(() => expect(ids(result.current)).toEqual({ a: ["a-1"], b: ["b-2", "b-1"] }));
    expect(titles(result.current).a).toEqual(["renamed"]);
  });

  it("stops listening on unmount", async () => {
    const { unmount } = renderHook(() => useResearchTasks(["a"]));
    await waitFor(() => expect(mocks.onTask).not.toBeNull());
    await act(async () => {});
    expect(mocks.unlisten).not.toHaveBeenCalled();
    unmount();
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  it("stops a listener that starts after unmount right away", async () => {
    const late = deferred<() => void>();
    mocks.listenForResearchTaskChanges.mockReturnValue(late.promise);
    const { unmount } = renderHook(() => useResearchTasks(["a"]));
    unmount();
    expect(mocks.unlisten).not.toHaveBeenCalled();
    await act(async () => late.resolve(mocks.unlisten));
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  it("logs a listener that fails to start", async () => {
    const failure = new Error("no events");
    mocks.listenForResearchTaskChanges.mockRejectedValue(failure);
    const { unmount } = renderHook(() => useResearchTasks(["a"]));
    await waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("watch research tasks for notes", failure));
    unmount();
    expect(mocks.unlisten).not.toHaveBeenCalled();
  });
});
