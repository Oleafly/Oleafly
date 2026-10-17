import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZoteroLibraryStatus } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  sync: vi.fn(),
  keys: vi.fn(),
  test: vi.fn(),
  setEnabled: vi.fn(),
  search: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  zoteroLibraryStatus: mocks.status,
  zoteroLibrarySync: mocks.sync,
  zoteroLibraryKeys: mocks.keys,
  zoteroLibraryTest: mocks.test,
  zoteroLibrarySetEnabled: mocks.setEnabled,
  zoteroLibrarySearch: mocks.search,
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import { zoteroHint } from "@/lib/zotero/hint";
import { cachedZoteroSearch, searchZoteroLibrary } from "@/lib/zotero/search-client";
import { resetZoteroLibraryForTest, useZoteroLibraryStore, zoteroHasKey } from "./zotero-library";

function status(generation: number, itemCount = 2): ZoteroLibraryStatus {
  return {
    local: { state: "ready" },
    web: "notConnected",
    libraries: [],
    itemCount,
    syncing: false,
    generation,
    bbtSeen: false,
    loaded: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetZoteroLibraryForTest();
  mocks.keys.mockImplementation(async () => ({ generation: 1, keys: ["smith2020", "oldKey"] }));
  mocks.search.mockResolvedValue({ generation: 1, total: 0, hits: [] });
});

describe("Zotero library store", () => {
  it("loads the key set once per library generation", async () => {
    useZoteroLibraryStore.getState().applyStatus(status(1));
    await vi.waitFor(() => expect(zoteroHasKey("oldKey")).toBe(true));
    useZoteroLibraryStore.getState().applyStatus(status(1));
    expect(mocks.keys).toHaveBeenCalledTimes(1);
    expect(useZoteroLibraryStore.getState().keysGeneration).toBe(1);
  });

  it("drops cached searches when the library changes and clears keys when it empties", async () => {
    useZoteroLibraryStore.getState().applyStatus(status(1));
    await searchZoteroLibrary("smi", { generation: 1, delayMs: 0 });
    expect(cachedZoteroSearch("smi", 1)).not.toBeNull();
    mocks.keys.mockResolvedValue({ generation: 2, keys: [] });
    useZoteroLibraryStore.getState().applyStatus(status(2, 0));
    expect(cachedZoteroSearch("smi", 1)).toBeNull();
    expect(zoteroHasKey("oldKey")).toBe(false);
  });

  it("folds a burst of focus events into one background refresh and passes the offline setting", async () => {
    mocks.sync.mockResolvedValue(status(1));
    useZoteroLibraryStore.getState().syncInBackground();
    useZoteroLibraryStore.getState().syncInBackground();
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.sync).toHaveBeenCalledWith(false, false);
  });

  it("asks again on the next focus so the @ list learns that Zotero was closed", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      mocks.sync.mockResolvedValueOnce(status(1));
      useZoteroLibraryStore.getState().syncInBackground();
      await vi.waitFor(() => expect(useZoteroLibraryStore.getState().status?.local.state).toBe("ready"));
      expect(zoteroHint(useZoteroLibraryStore.getState().status)).toBeNull();
      mocks.sync.mockResolvedValueOnce({ ...status(1), local: { state: "notRunning" }, lastSync: 999_000 });
      now.mockReturnValue(1_015_000);
      useZoteroLibraryStore.getState().syncInBackground();
      expect(mocks.sync).toHaveBeenCalledTimes(2);
      await vi.waitFor(() => expect(zoteroHint(useZoteroLibraryStore.getState().status)).toBe("closedCached"));
    } finally {
      now.mockRestore();
    }
  });

  it("forces a sync after a successful connection test and keeps a failed one", async () => {
    mocks.test.mockResolvedValueOnce({ local: { state: "ready" }, web: "notConnected", libraries: [], source: "local" });
    mocks.sync.mockResolvedValue(status(1));
    await useZoteroLibraryStore.getState().test();
    expect(mocks.sync).toHaveBeenCalledWith(false, true);
    mocks.test.mockResolvedValueOnce({ local: { state: "apiDisabled" }, web: "notConnected", libraries: [], error: "x" });
    mocks.sync.mockClear();
    await useZoteroLibraryStore.getState().test();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(useZoteroLibraryStore.getState().report?.error).toBe("x");
  });
});
