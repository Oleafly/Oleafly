import { describe, expect, it, vi } from "vitest";

// ChatCore now renders ModelSelector, which renders ProviderLogo. This test only
// exercises ChatCore's pure exported helpers, but importing the module still runs
// its full top-level import graph, which drags in @lobehub/icons's fluent-emoji
// dependency. That package ships a directory import (`./FluentEmoji` with no
// extension) that Vitest's native ESM resolution refuses, unrelated to anything
// under test here, so stub the logo component out before importing ChatCore.
vi.mock("@/components/ai/ProviderLogo", () => ({ ProviderLogo: () => null }));

import { buildAiToolInventory, buildToolContinuation, resolveChatTools } from "./ChatCore";

describe("AI capability inventory", () => {
  it("omits source-map and figure tools when unavailable", () => {
    expect(buildAiToolInventory([], false, false)).not.toContain("project_map");
    expect(buildAiToolInventory([], true, false)).toEqual([]);
  });
  it("includes only capability-backed specialized tools", () => {
    expect(buildAiToolInventory(["document_index"], false, false)).toContain("project_map");
    expect(buildAiToolInventory([], true, true)).toEqual(["preview_figure", "insert_figure", "load_image"]);
  });
});

describe("chat tool resolution", () => {
  it("merges tools from every toolset sharing the active mode, not just the first match", () => {
    const toolsets = [
      { id: "project-tools", mode: "chat", create: () => ({ write_file: {} }) },
      { id: "figure-tools", mode: "figure", create: () => ({ preview_figure: {} }) },
      { id: "research-tools", mode: "chat", create: () => ({ alphaxiv_search: {} }) },
    ];
    const tools = resolveChatTools(toolsets, "chat", {});
    expect(Object.keys(tools)).toContain("write_file");
    expect(Object.keys(tools)).toContain("alphaxiv_search");
  });

  it("keeps figure mode limited to the figure toolset only", () => {
    const toolsets = [
      { id: "project-tools", mode: "chat", create: () => ({ write_file: {} }) },
      { id: "figure-tools", mode: "figure", create: () => ({ preview_figure: {} }) },
      { id: "research-tools", mode: "chat", create: () => ({ alphaxiv_search: {} }) },
    ];
    const tools = resolveChatTools(toolsets, "figure", {});
    expect(Object.keys(tools)).toEqual(["preview_figure"]);
  });
});

describe("AI tool continuation", () => {
  it("preserves reasoning before the tool call", () => {
    expect(
      buildToolContinuation("I should inspect the file.", "", [
        { id: "call-1", name: "read_file", args: { path: "main.tex" } },
      ]),
    ).toEqual([
      { type: "reasoning", text: "I should inspect the file." },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "read_file",
        input: { path: "main.tex" },
      },
    ]);
  });
});
