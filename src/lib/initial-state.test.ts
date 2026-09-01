// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialState, seedStarterPersonas } from "@/lib/tauri";
import { appQueryClient } from "@/lib/query";
import { projectsKey } from "@/lib/queries/projects";
import { useFilesStore } from "@/store/files";
import { getSnapshotConfig, hydrateFromSnapshot } from "./initial-state";

vi.mock("@/lib/tauri", () => ({
  initialState: vi.fn(),
  listProjects: vi.fn(),
  seedStarterPersonas: vi.fn(),
}));

const mockInitial = vi.mocked(initialState);
const mockSeedStarterPersonas = vi.mocked(seedStarterPersonas);

const PROJECTS = [
  { id: "b", name: "B", updated_at: 5 },
  { id: "a", name: "A", updated_at: 9 },
] as never[];

describe("startup snapshot hydration", () => {
  beforeEach(() => {
    mockInitial.mockReset();
    mockSeedStarterPersonas.mockReset();
    appQueryClient().clear();
    useFilesStore.setState({ projects: [], projectsLoaded: false });
  });

  it("seeds the project listing store and query cache before first render", async () => {
    mockInitial.mockResolvedValue({
      config: {
        ai_provider: "openai",
        ai_personas: [],
        ai_starter_personas_seeded: true,
      } as never,
      projects: PROJECTS,
    });

    await hydrateFromSnapshot();

    const files = useFilesStore.getState();
    expect(files.projectsLoaded).toBe(true);
    expect(files.projects.map((p) => p.id)).toEqual(["a", "b"]);
    expect(appQueryClient().getQueryData(projectsKey)).toEqual(PROJECTS);
    expect(getSnapshotConfig()?.ai_provider).toBe("openai");
    expect(mockSeedStarterPersonas).not.toHaveBeenCalled();
  });

  it("atomically persists all starter personas without restoring stale config fields", async () => {
    mockInitial.mockResolvedValue({
      config: {
        ai_provider: "openai",
        ai_personas: [],
        ai_starter_personas_seeded: false,
      } as never,
      projects: PROJECTS,
    });
    mockSeedStarterPersonas.mockResolvedValue({
      ai_provider: "openai",
      ai_personas: [
        { id: "starter-research-writer" },
        { id: "starter-document-editor" },
        { id: "starter-critical-reviewer" },
        { id: "starter-figure" },
      ],
      ai_starter_personas_seeded: true,
      mcp_port: 65001,
    } as never);

    await hydrateFromSnapshot();

    expect(mockSeedStarterPersonas).toHaveBeenCalledOnce();
    const starters = mockSeedStarterPersonas.mock.calls[0]?.[0] ?? [];
    expect(starters.map((persona) => persona.id)).toEqual([
      "starter-research-writer",
      "starter-document-editor",
      "starter-critical-reviewer",
      "starter-figure",
    ]);
    expect(starters.every((persona) => !("description" in persona))).toBe(true);
    expect(getSnapshotConfig()?.ai_personas).toHaveLength(4);
    expect(getSnapshotConfig()?.mcp_port).toBe(65001);
  });

  it("still hydrates projects when starter persona persistence fails", async () => {
    mockInitial.mockResolvedValue({
      config: {
        ai_provider: "openai",
        ai_personas: [],
        ai_starter_personas_seeded: false,
      } as never,
      projects: PROJECTS,
    });
    mockSeedStarterPersonas.mockRejectedValue(new Error("disk unavailable"));

    await expect(hydrateFromSnapshot()).resolves.toBeUndefined();

    expect(useFilesStore.getState().projectsLoaded).toBe(true);
    expect(useFilesStore.getState().projects).toHaveLength(2);
    expect(getSnapshotConfig()?.ai_starter_personas_seeded).toBe(false);
  });

  it("retries the atomic seed when the startup snapshot config is unavailable", async () => {
    mockInitial.mockResolvedValue({ config: null, projects: PROJECTS });
    mockSeedStarterPersonas.mockResolvedValue({
      ai_personas: [],
      ai_starter_personas_seeded: true,
      mcp_port: 65002,
    } as never);

    await hydrateFromSnapshot();

    expect(mockSeedStarterPersonas).toHaveBeenCalledOnce();
    expect(getSnapshotConfig()?.ai_starter_personas_seeded).toBe(true);
    expect(getSnapshotConfig()?.mcp_port).toBe(65002);
    expect(useFilesStore.getState().projectsLoaded).toBe(true);
  });

  it("never throws when the backend snapshot is unavailable", async () => {
    mockInitial.mockRejectedValue(new Error("no backend"));

    await expect(hydrateFromSnapshot()).resolves.toBeUndefined();
    expect(useFilesStore.getState().projectsLoaded).toBe(false);
  });
});
