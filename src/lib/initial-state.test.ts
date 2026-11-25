// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig, initialState, } from "@/lib/tauri";
import { appQueryClient } from "@/lib/query";
import { useFilesStore } from "@/store/files";
import { getConfigCached, invalidateConfigCache } from "@/lib/config-cache";
import { getSnapshotPendingOpen, hydrateFromSnapshot } from "./initial-state";

vi.mock("@/lib/tauri", () => ({
  initialState: vi.fn(),
  listProjects: vi.fn(),
  seedStarterPersonas: vi.fn(),
  getConfig: vi.fn(),
}));

const mockInitial = vi.mocked(initialState);
const mockGetConfig = vi.mocked(getConfig);

const PROJECTS = [
  { id: "b", name: "B", updated_at: 5 },
  { id: "a", name: "A", updated_at: 9 },
] as never[];

describe("startup snapshot hydration", () => {
  beforeEach(() => {
    mockInitial.mockReset();
    mockGetConfig.mockReset();
    invalidateConfigCache();
    appQueryClient().clear();
    useFilesStore.setState({ projects: [], projectsLoaded: false });
  });

  it("keeps the folders the OS asked to open so the splash can name them", async () => {
    mockInitial.mockResolvedValue({
      config: { } as never,
      projects: [],
      pending_open: [{ token: "t1", display_name: "thesis", source: "launch" }],
    });

    await hydrateFromSnapshot();

    expect(getSnapshotPendingOpen()).toEqual([
      { token: "t1", display_name: "thesis", source: "launch" },
    ]);
  });

  it("treats a snapshot from an older backend as having nothing to open", async () => {
    mockInitial.mockResolvedValue({
      config: { } as never,
      projects: [],
    });

    await hydrateFromSnapshot();

    expect(getSnapshotPendingOpen()).toEqual([]);
  });

  it("hands the startup config to later config reads without another IPC", async () => {
    mockInitial.mockResolvedValue({
      config: { } as never,
      projects: PROJECTS,
    });

    await hydrateFromSnapshot();

    await expect(getConfigCached()).resolves.toMatchObject({ });
    expect(mockGetConfig).not.toHaveBeenCalled();
  });

  it("hands over the config the starter personas were saved into", async () => {
    mockInitial.mockResolvedValue({
      config: { } as never,
      projects: PROJECTS,
    });

    await hydrateFromSnapshot();

    await expect(getConfigCached()).resolves.toMatchObject({ });
    expect(mockGetConfig).not.toHaveBeenCalled();
  });

  it("leaves config reads to the backend when the snapshot had no config", async () => {
    mockInitial.mockResolvedValue({ config: null, projects: PROJECTS });
    mockGetConfig.mockResolvedValue({ } as never);

    await hydrateFromSnapshot();

    await expect(getConfigCached()).resolves.toMatchObject({ });
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("never throws when the backend snapshot is unavailable", async () => {
    mockInitial.mockRejectedValue(new Error("no backend"));

    await expect(hydrateFromSnapshot()).resolves.toBeUndefined();
    expect(useFilesStore.getState().projectsLoaded).toBe(false);
  });
});
