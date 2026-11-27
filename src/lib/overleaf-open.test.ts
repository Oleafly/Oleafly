import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
  overleaf: { importSelected: vi.fn(), openLive: vi.fn() },
  files: { refreshProjects: vi.fn(async () => {}) },
}));

vi.mock("@/store/overleaf-import", () => ({ useOverleafImportStore: { getState: () => stores.overleaf } }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => stores.files } }));

import { importAndRefresh, openLiveAndRefresh } from "./overleaf-open";

beforeEach(() => {
  stores.overleaf.importSelected.mockReset();
  stores.overleaf.openLive.mockReset();
  stores.files.refreshProjects.mockClear();
});

describe("importing from Overleaf", () => {
  it("refreshes the library once something was imported and returns every outcome", async () => {
    const outcomes = [
      { remoteId: "a", projectId: "local-a", error: null },
      { remoteId: "b", projectId: null, error: "offline" },
    ];
    stores.overleaf.importSelected.mockResolvedValue(outcomes);
    expect(await importAndRefresh(["a", "b"])).toBe(outcomes);
    expect(stores.overleaf.importSelected).toHaveBeenCalledWith(["a", "b"]);
    expect(stores.files.refreshProjects).toHaveBeenCalledOnce();
  });

  it("imports the selection when no ids are given and leaves the library alone when nothing came in", async () => {
    stores.overleaf.importSelected.mockResolvedValue([{ remoteId: "a", projectId: null, error: "offline" }]);
    expect(await importAndRefresh()).toEqual([{ remoteId: "a", projectId: null, error: "offline" }]);
    expect(stores.overleaf.importSelected).toHaveBeenCalledWith(undefined);
    expect(stores.files.refreshProjects).not.toHaveBeenCalled();
  });
});

describe("opening an Overleaf project live", () => {
  it("refreshes the library, then opens the project", async () => {
    stores.overleaf.openLive.mockResolvedValue("local-a");
    const onOpened = vi.fn();
    expect(await openLiveAndRefresh("a", onOpened)).toBe("local-a");
    expect(stores.overleaf.openLive).toHaveBeenCalledWith("a");
    expect(onOpened).toHaveBeenCalledWith("local-a");
    expect(stores.files.refreshProjects.mock.invocationCallOrder[0]).toBeLessThan(onOpened.mock.invocationCallOrder[0]);
    expect(await openLiveAndRefresh("a")).toBe("local-a");
  });

  it("refreshes nothing and opens nothing when the open did not happen", async () => {
    stores.overleaf.openLive.mockResolvedValue(null);
    const onOpened = vi.fn();
    expect(await openLiveAndRefresh("a", onOpened)).toBeNull();
    expect(stores.files.refreshProjects).not.toHaveBeenCalled();
    expect(onOpened).not.toHaveBeenCalled();
  });
});
