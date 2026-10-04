import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  mcpAgentToolsList: vi.fn(),
  mcpAgentToolAuthorize: vi.fn(async () => "approval"),
  mcpAgentToolCall: vi.fn(async () => ({ content: [{ type: "image", mime_type: "IMAGE/PNG", data: "AA" }, "plain"] })),
}));

import { createMcpArgumentPreview, createMcpRuntimeToolsets } from "./mcp-agent-tools";
import { mcpAgentToolAuthorize, mcpAgentToolCall } from "@/lib/tauri";

describe("createMcpArgumentPreview", () => {
  it("keeps scalars, stringifies values JSON cannot show and marks cycles", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const preview = JSON.parse(
      createMcpArgumentPreview({
        flag: true,
        nothing: null,
        count: 3,
        infinite: Number.POSITIVE_INFINITY,
        missing: undefined,
        big: 10n,
        cyclic,
      }),
    );
    expect(preview).toEqual({
      flag: true,
      nothing: null,
      count: 3,
      infinite: "Infinity",
      missing: "undefined",
      big: "10",
      cyclic: { name: "loop", self: "[truncated]" },
    });
  });

  it("bounds long lists, wide objects and deep nesting", () => {
    const wide = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`k${index}`, index]));
    const preview = JSON.parse(
      createMcpArgumentPreview({
        list: Array.from({ length: 15 }, (_, index) => index),
        wide,
        deep: { level1: { level2: { level3: "hidden" } } },
      }),
    );
    expect(preview.list).toEqual([...Array.from({ length: 12 }, (_, index) => index), "[truncated]"]);
    expect(Object.keys(preview.wide)).toHaveLength(13);
    expect(preview.wide["..."]).toBe("[truncated]");
    expect(preview.deep).toEqual({ level1: { level2: "[truncated]" } });
  });

  it("cuts an oversized preview to its length budget", () => {
    const input = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`field${index}`, "x".repeat(150)]));
    const preview = createMcpArgumentPreview(input);
    expect(preview).toHaveLength(1_200);
    expect(preview.endsWith("\n... [truncated]")).toBe(true);
  });
});

describe("createMcpRuntimeToolsets edge cases", () => {
  const options = {
    projectId: () => "project",
    runId: () => "run",
    isActive: () => true,
    confirm: vi.fn(async () => true),
    onImage: vi.fn(),
  };

  it("skips servers without tools and gives undocumented tools an empty description", () => {
    const toolsets = createMcpRuntimeToolsets(
      [
        { name: "Empty", tools: [] },
        { name: "Papers", tools: [{ name: "mcp__papers__x", tool_handle: "x", input_schema: { type: "object" } }] },
      ] as never,
      options,
    );
    expect(toolsets.map((toolset) => toolset.id)).toEqual(["mcp:Papers"]);
    expect((toolsets[0].tools.mcp__papers__x as { description: string }).description).toBe("");
  });

  it("sends an empty argument record for non-object input and accepts snake-case image types", async () => {
    const [toolset] = createMcpRuntimeToolsets(
      [{ name: "Papers", tools: [{ name: "mcp__papers__x", tool_handle: "x", input_schema: { type: "object" } }] }] as never,
      options,
    );
    const tool = toolset.tools.mcp__papers__x as { execute: (input: unknown) => Promise<unknown> };
    const result = await tool.execute("not an object");
    expect(mcpAgentToolAuthorize).toHaveBeenCalledWith("project", "Papers", "x", {}, "run");
    expect(mcpAgentToolCall).toHaveBeenCalledWith("project", "Papers", "x", {}, "run", "approval");
    expect(options.onImage).toHaveBeenCalledWith("data:image/png;base64,AA");
    expect(result).toEqual({ content: [{ type: "text", text: "The MCP server returned an image." }, "plain"] });
  });
});
