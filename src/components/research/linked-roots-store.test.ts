import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getResearchWorkspace: vi.fn(),
  getResearchRootHealth: vi.fn(),
  listResearchRootFiles: vi.fn(),
}));

vi.mock("@/lib/research-workspace", () => api);

import { linkedNodeKey, useLinkedRootsStore } from "./linked-roots-store";

const root = { id: "root-1", canonicalPath: "/data/survey", identity: "id-1", label: "Survey" };
const health = { rootId: "root-1", availability: "available", detail: null };
const entry = { relativePath: "notes.md", name: "notes.md", isDirectory: false };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function state() {
  return useLinkedRootsStore.getState();
}

beforeEach(async () => {
  api.getResearchWorkspace.mockReset().mockResolvedValue({ roots: [root] });
  api.getResearchRootHealth.mockReset().mockResolvedValue([health]);
  api.listResearchRootFiles.mockReset().mockResolvedValue({ entries: [entry] });
  await state().bindProject(null);
});

describe("linked research roots", () => {
  it("loads the project's roots with their health", async () => {
    await state().bindProject("project-1");

    expect(state().roots).toEqual([root]);
    expect(state().health).toEqual({ "root-1": health });
    expect(state().error).toBeNull();
  });

  it("keeps the roots when the health check fails", async () => {
    api.getResearchRootHealth.mockRejectedValue(new Error("probe failed"));

    await state().bindProject("project-1");

    expect(state().roots).toEqual([root]);
    expect(state().health).toEqual({});
  });

  it("reports a workspace that cannot be read", async () => {
    api.getResearchWorkspace.mockRejectedValueOnce(new Error("no workspace"));
    await state().bindProject("project-1");
    expect(state().error).toBe("no workspace");

    api.getResearchWorkspace.mockRejectedValueOnce("denied");
    await state().bindProject("project-1");
    expect(state().error).toBe("denied");
  });

  it("ignores a slow load for a project that is no longer bound", async () => {
    const slow = deferred<{ roots: (typeof root)[] }>();
    api.getResearchWorkspace.mockReturnValueOnce(slow.promise);
    const first = state().bindProject("project-1");
    await state().bindProject("project-2");

    slow.resolve({ roots: [{ ...root, id: "stale" }] });
    await first;

    expect(state().projectId).toBe("project-2");
    expect(state().roots).toEqual([root]);
  });

  it("ignores a slow failure for a project that is no longer bound", async () => {
    const slow = deferred<{ roots: (typeof root)[] }>();
    api.getResearchWorkspace.mockReturnValueOnce(slow.promise);
    const first = state().bindProject("project-1");
    await state().bindProject("project-2");

    slow.reject(new Error("late"));
    await first;

    expect(state().error).toBeNull();
  });

  it("refreshes the roots and drops cached listings", async () => {
    await state().bindProject("project-1");
    state().toggle("root-1", "");
    await vi.waitFor(() => expect(state().listings[linkedNodeKey("root-1", "")]).toEqual([entry]));
    api.getResearchWorkspace.mockResolvedValue({ roots: [root, { ...root, id: "root-2" }] });

    await state().refresh();

    expect(state().roots).toHaveLength(2);
    expect(state().listings).toEqual({});
  });

  it("reports a failed refresh and does nothing without a project", async () => {
    await state().refresh();
    expect(api.getResearchWorkspace).not.toHaveBeenCalled();

    await state().bindProject("project-1");
    api.getResearchWorkspace.mockRejectedValueOnce(new Error("offline"));
    await state().refresh();

    expect(state().error).toBe("offline");
  });

  it("drops a refresh that finishes after the project changed", async () => {
    await state().bindProject("project-1");
    const slow = deferred<{ roots: (typeof root)[] }>();
    const slowFailure = deferred<{ roots: (typeof root)[] }>();
    api.getResearchWorkspace.mockReturnValueOnce(slow.promise).mockReturnValueOnce(slowFailure.promise);
    const refreshing = state().refresh();
    const failing = state().refresh();
    await state().bindProject("project-2");

    slow.resolve({ roots: [] });
    slowFailure.reject(new Error("late"));
    await refreshing;
    await failing;

    expect(state().projectId).toBe("project-2");
    expect(state().roots).toEqual([root]);
    expect(state().error).toBeNull();
  });

  it("expands a folder once, loading its files, and collapses it again", async () => {
    await state().bindProject("project-1");
    const key = linkedNodeKey("root-1", "data");

    state().toggle("root-1", "data");
    expect(state().expanded).toEqual([key]);
    await vi.waitFor(() => expect(state().listings[key]).toEqual([entry]));
    expect(api.listResearchRootFiles).toHaveBeenCalledWith("project-1", "root-1", "data", 0);

    state().toggle("root-1", "data");
    expect(state().expanded).toEqual([]);
    state().toggle("root-1", "data");
    expect(state().expanded).toEqual([key]);
    expect(api.listResearchRootFiles).toHaveBeenCalledTimes(1);
  });

  it("records a folder that cannot be listed and clears the error on retry", async () => {
    await state().bindProject("project-1");
    const key = linkedNodeKey("root-1", "data");
    api.listResearchRootFiles.mockRejectedValueOnce(new Error("permission denied"));

    await state().loadDirectory("root-1", "data");
    expect(state().errors[key]).toBe("permission denied");
    expect(state().loading[key]).toBe(false);

    const retry = state().loadDirectory("root-1", "data");
    expect(state().errors[key]).toBeUndefined();
    await retry;
    expect(state().listings[key]).toEqual([entry]);
  });

  it("does not list folders twice at once or without a project", async () => {
    await state().loadDirectory("root-1", "");
    expect(api.listResearchRootFiles).not.toHaveBeenCalled();

    await state().bindProject("project-1");
    const slow = deferred<{ entries: (typeof entry)[] }>();
    api.listResearchRootFiles.mockReturnValueOnce(slow.promise);
    const first = state().loadDirectory("root-1", "");
    await state().loadDirectory("root-1", "");
    expect(api.listResearchRootFiles).toHaveBeenCalledTimes(1);

    slow.resolve({ entries: [entry] });
    await first;
  });

  it("drops a listing that finishes after the project changed", async () => {
    await state().bindProject("project-1");
    const slow = deferred<{ entries: (typeof entry)[] }>();
    const failing = deferred<{ entries: (typeof entry)[] }>();
    api.listResearchRootFiles.mockReturnValueOnce(slow.promise).mockReturnValueOnce(failing.promise);
    const listing = state().loadDirectory("root-1", "a");
    const broken = state().loadDirectory("root-1", "b");
    await state().bindProject("project-2");

    slow.resolve({ entries: [entry] });
    failing.reject(new Error("late"));
    await listing;
    await broken;

    expect(state().listings).toEqual({});
    expect(state().errors).toEqual({});
  });
});
