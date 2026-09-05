import { describe, expect, it } from "vitest";

import {
  buildAiToolInventory,
  buildToolContinuation,
  drainPendingImages,
  excludedToolNames,
  figureGuidance,
  resolveChatTools,
  resolveResponseInstructions,
} from "./ChatCore";
import { filterResolvedTools } from "@/lib/ai-tool-availability";

describe("AI capability inventory", () => {
  it("omits the source map when the engine has no document index", () => {
    expect(buildAiToolInventory([])).not.toContain("project_map");
  });

  it("includes only capability-backed specialized tools", () => {
    expect(buildAiToolInventory(["document_index"])).toContain("project_map");
  });

  it("omits disabled tools while keeping unknown tools enabled", () => {
    const enabledByName = { compile: false };

    expect(buildAiToolInventory([], enabledByName)).not.toContain("compile");
    expect(buildAiToolInventory([], enabledByName)).toContain("read_file");
  });

  it("reports the resolved run tools when they are supplied", () => {
    expect(
      buildAiToolInventory([], {}, ["read_file", "preview_figure", "insert_figure"]),
    ).toEqual(["read_file", "preview_figure", "insert_figure"]);
  });
});

describe("run tool exclusions", () => {
  it("drops the figure tools when the engine cannot compile one in isolation", () => {
    expect(excludedToolNames(["document_index"], false)).toEqual([
      "preview_figure",
      "insert_figure",
      "load_image",
    ]);
  });

  it("keeps the figure tools for an engine that supports them", () => {
    expect(excludedToolNames(["document_index"], true)).toEqual([]);
    expect(excludedToolNames([], true)).toEqual(["project_map"]);
  });
});

describe("figure guidance", () => {
  it("is absent unless the run actually offers preview_figure", () => {
    expect(figureGuidance(["read_file", "compile"])).toBe("");
  });

  it("tells the model to preview, refine, and then insert", () => {
    const block = figureGuidance(["read_file", "preview_figure", "insert_figure", "load_image"]);

    expect(block).toContain("Figures and diagrams:");
    expect(block).toContain("preview_figure");
    expect(block).toContain("insert_figure");
    expect(block).toContain("load_image");
    expect(block).toContain("Never invent data.");
    expect(block).not.toContain("\u2014");
  });
});

describe("pending tool images", () => {
  it("always drains queued images even when the active model cannot receive them", () => {
    const unsupported = ["data:image/png;base64,QUJD"];
    expect(drainPendingImages(unsupported, false)).toEqual([]);
    expect(unsupported).toEqual([]);

    const supported = ["data:image/png;base64,REVG"];
    expect(drainPendingImages(supported, true)).toEqual([
      "data:image/png;base64,REVG",
    ]);
    expect(supported).toEqual([]);
  });
});

describe("chat tool resolution", () => {
  it("merges tools from every toolset sharing the active mode, not just the first match", () => {
    const toolsets = [
      { id: "project-tools", mode: "chat", create: () => ({ write_file: {} }) },
      { id: "figure-tools", mode: "chat", create: () => ({ preview_figure: {} }) },
      { id: "research-tools", mode: "chat", create: () => ({ alphaxiv_search: {} }) },
    ];
    const tools = resolveChatTools(toolsets, "chat", {});
    expect(Object.keys(tools)).toContain("write_file");
    expect(Object.keys(tools)).toContain("alphaxiv_search");
  });

  it("carries the figure toolset in the ordinary chat run", () => {
    const toolsets = [
      { id: "project-tools", mode: "chat", create: () => ({ write_file: {} }) },
      { id: "figure-tools", mode: "chat", create: () => ({ preview_figure: {} }) },
      { id: "research-tools", mode: "chat", create: () => ({ alphaxiv_search: {} }) },
    ];
    const tools = resolveChatTools(toolsets, "chat", {});
    expect(Object.keys(tools)).toEqual([
      "write_file",
      "preview_figure",
      "alphaxiv_search",
    ]);
  });

  it("removes a disabled MCP tool from the resolved schemas", () => {
    const toolsets = [
      { id: "project-tools", mode: "chat", create: () => ({ read_file: {} }) },
      {
        id: "mcp:papers",
        mode: "chat",
        create: () => ({ search_papers: {}, fetch_paper: {} }),
      },
    ];
    const tools = resolveChatTools(toolsets, "chat", {});

    expect(Object.keys(filterResolvedTools({ tools, groups: [] }, {
      search_papers: false,
    }).tools)).toEqual(["read_file", "fetch_paper"]);
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

describe("persona instructions", () => {
  const personas = [
    {
      id: "research-writer",
      name: "Research Writer",
      color: "ocean",
      prompt: "Use a formal academic style.",
    },
  ];

  it("uses the default instructions when no persona is active", () => {
    expect(
      resolveResponseInstructions(personas, null, "Keep responses brief."),
    ).toBe("Keep responses brief.");
  });

  it("replaces the default instructions when a persona is active", () => {
    expect(
      resolveResponseInstructions(
        personas,
        "research-writer",
        "Keep responses brief.",
      ),
    ).toBe("Use a formal academic style.");
  });

  it("never falls back to the default instructions for a stale persona selection", () => {
    expect(
      resolveResponseInstructions(personas, "missing-persona", "Keep responses brief."),
    ).toBe("");
  });
});
