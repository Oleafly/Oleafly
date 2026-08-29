// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialState } from "@/lib/tauri";
import { appQueryClient } from "@/lib/query";
import { projectsKey } from "@/lib/queries/projects";
import { useFilesStore } from "@/store/files";
import { getSnapshotConfig, hydrateFromSnapshot } from "./initial-state";

vi.mock("@/lib/tauri", () => ({
  initialState: vi.fn(),
  listProjects: vi.fn(),
}));

const mockInitial = vi.mocked(initialState);

const PROJECTS = [
  { id: "b", name: "B", updated_at: 5 },
  { id: "a", name: "A", updated_at: 9 },
] as never[];

describe("startup snapshot hydration", () => {
  beforeEach(() => {
    mockInitial.mockReset();
    appQueryClient().clear();
    useFilesStore.setState({ projects: [], projectsLoaded: false });
  });

  it("seeds the project listing store and query cache before first render", async () => {
    mockInitial.mockResolvedValue({
      config: { ai_provider: "openai" } as never,
      projects: PROJECTS,
    });

    await hydrateFromSnapshot();

    const files = useFilesStore.getState();
    expect(files.projectsLoaded).toBe(true);
    expect(files.projects.map((p) => p.id)).toEqual(["a", "b"]);
    expect(appQueryClient().getQueryData(projectsKey)).toEqual(PROJECTS);
    expect(getSnapshotConfig()?.ai_provider).toBe("openai");
  });

  it("never throws when the backend snapshot is unavailable", async () => {
    mockInitial.mockRejectedValue(new Error("no backend"));

    await expect(hydrateFromSnapshot()).resolves.toBeUndefined();
    expect(useFilesStore.getState().projectsLoaded).toBe(false);
  });
});
