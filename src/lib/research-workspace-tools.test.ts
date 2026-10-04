import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { createResearchWorkspaceTools } from "./research-workspace-tools";

type Exec = (input?: unknown) => Promise<unknown>;

function tool(projectId: string, name: string): Exec {
  const tools = createResearchWorkspaceTools(projectId) as Record<string, { execute: Exec }>;
  return tools[name].execute;
}

beforeEach(() => {
  invoke.mockReset();
});

describe("createResearchWorkspaceTools", () => {
  it("offers no tools without an open project", () => {
    expect(createResearchWorkspaceTools(null)).toEqual({});
  });

  it("offers the three read-only research tools for a project", () => {
    expect(Object.keys(createResearchWorkspaceTools("paper")).sort()).toEqual([
      "list_research_root_files",
      "list_research_roots",
      "read_research_root_file",
    ]);
  });

  it("lists linked roots as read-only entries with their stable ids", async () => {
    invoke.mockResolvedValue({
      version: 1,
      primaryProjectId: "paper",
      updatedAtMs: 1,
      roots: [
        { id: "r1", canonicalPath: "/data", identity: "x", label: "Study data", role: "data", access: "read_write", createdAtMs: 1 },
      ],
    });
    await expect(tool("paper", "list_research_roots")()).resolves.toEqual([
      { rootId: "r1", label: "Study data", role: "data", access: "read_only" },
    ]);
    expect(invoke).toHaveBeenCalledWith("get_research_workspace", { projectId: "paper" });
  });

  it("lists files in a root with a bounded depth", async () => {
    invoke.mockResolvedValue({ entries: [] });
    await tool("paper", "list_research_root_files")({ rootId: "r1", path: "raw" });
    expect(invoke).toHaveBeenCalledWith("list_research_root_files", {
      projectId: "paper",
      rootId: "r1",
      relativePath: "raw",
      maxDepth: 3,
    });
  });

  it("reads a file with a 128 KiB cap", async () => {
    invoke.mockResolvedValue({ text: "a,b" });
    await expect(tool("paper", "read_research_root_file")({ rootId: "r1", path: "t.csv" })).resolves.toEqual({ text: "a,b" });
    expect(invoke).toHaveBeenCalledWith("read_research_root_file", {
      projectId: "paper",
      rootId: "r1",
      relativePath: "t.csv",
      maxBytes: 128 * 1024,
    });
  });

  it.each([
    ["missing input", undefined],
    ["a non-object input", "r1"],
    ["non-string fields", { rootId: 7, path: ["x"] }],
  ])("sends empty ids for %s", async (_label, input) => {
    invoke.mockResolvedValue({ entries: [] });
    await tool("paper", "list_research_root_files")(input);
    expect(invoke).toHaveBeenCalledWith("list_research_root_files", {
      projectId: "paper",
      rootId: "",
      relativePath: "",
      maxDepth: 3,
    });
  });
});
