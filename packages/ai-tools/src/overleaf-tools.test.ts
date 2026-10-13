import { describe, expect, it, vi } from "vitest";
import { createOverleafTools, type OverleafToolsHost } from "./overleaf-tools";

function host(overrides: Partial<OverleafToolsHost> = {}): OverleafToolsHost {
  return {
    listProjects: vi.fn(async () => ({
      email: "ada@uni.edu",
      server: "https://www.overleaf.com",
      projects: [
        { id: "a", name: "Thesis", ownerName: "Ada", owned: true, lastUpdated: "2026-10-01", archived: false, importedAs: null },
        { id: "b", name: "Grant", ownerName: "Grace", owned: false, lastUpdated: null, archived: true, importedAs: "local-b" },
      ],
    })),
    importProjects: vi.fn(async (ids: string[]) =>
      ids.map((id) => (id === "bad" ? { remoteId: id, projectId: null, error: "denied" } : { remoteId: id, projectId: `local-${id}`, error: null })),
    ),
    describeError: (error) => `described: ${String(error)}`,
    ...overrides,
  };
}

describe("overleaf AI tools", () => {
  it("lists projects with owners and an optional name filter", async () => {
    const tools = createOverleafTools(host());
    expect(await tools.list_overleaf_projects.execute({})).toEqual({
      server: "https://www.overleaf.com",
      account: "ada@uni.edu",
      total: 2,
      truncated: false,
      projects: [
        { id: "a", name: "Thesis", owner: "you", lastUpdated: "2026-10-01", archived: false, importedAs: null },
        { id: "b", name: "Grant", owner: "Grace", lastUpdated: null, archived: true, importedAs: "local-b" },
      ],
    });
    const filtered = (await tools.list_overleaf_projects.execute({ query: "GRACE" })) as { projects: unknown[] };
    expect(filtered.projects).toHaveLength(1);
  });

  it("reports listing failures as text", async () => {
    const tools = createOverleafTools(host({ listProjects: vi.fn(async () => Promise.reject(new Error("expired"))) }));
    expect(await tools.list_overleaf_projects.execute({})).toEqual({ error: "described: Error: expired" });
  });

  it("validates ids, asks for approval and splits the outcome", async () => {
    const confirm = vi.fn(async () => true);
    const target = host();
    const tools = createOverleafTools(target, { confirm });
    expect(await tools.import_overleaf_projects.execute({ ids: [] })).toEqual({ error: "Provide at least one Overleaf project id." });
    expect(await tools.import_overleaf_projects.execute({ ids: Array.from({ length: 26 }, (_, index) => `p${index}`) })).toEqual({
      error: "Import at most 25 projects at a time.",
    });
    expect(await tools.import_overleaf_projects.execute({ ids: [" a ", "a", "bad", 7] })).toEqual({
      success: false,
      imported: [{ overleafId: "a", projectId: "local-a" }],
      failed: [{ overleafId: "bad", error: "described: denied" }],
    });
    expect(confirm).toHaveBeenCalledWith({ tool: "import_overleaf_projects", summary: "Import 2 projects from Overleaf" });
    expect(target.importProjects).toHaveBeenCalledWith(["a", "bad"]);
    await tools.import_overleaf_projects.execute({ ids: ["a"] });
    expect(confirm).toHaveBeenLastCalledWith({ tool: "import_overleaf_projects", summary: "Import 1 project from Overleaf" });
  });

  it("stops when the user declines and reports import failures", async () => {
    const declined = createOverleafTools(host(), { confirm: vi.fn(async () => false) });
    expect(await declined.import_overleaf_projects.execute({ ids: ["a"] })).toMatchObject({ declined: true });
    const failing = createOverleafTools(host({ importProjects: vi.fn(async () => Promise.reject(new Error("offline"))) }));
    expect(await failing.import_overleaf_projects.execute({ ids: ["a"] })).toEqual({ error: "described: Error: offline" });
    const allGood = createOverleafTools(host());
    expect(await allGood.import_overleaf_projects.execute({ ids: ["a"] })).toMatchObject({ success: true });
  });
});
