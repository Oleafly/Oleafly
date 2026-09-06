import { describe, expect, it } from "vitest";
import {
  filterResolvedTools,
  resolveAvailableTools,
  type RuntimeToolset,
} from "./ai-tool-availability";

const tool = (description: string) => ({ description });

describe("AI tool availability", () => {
  it("derives grouped entries from the active resolved toolsets", () => {
    const resolved = resolveAvailableTools({
      toolsets: [
        {
          id: "project-tools",
          mode: "chat",
          source: { kind: "project" },
          create: () => ({ read_file: tool("Read a project file.") }),
        },
        {
          id: "research-tools",
          mode: "chat",
          source: { kind: "project" },
          create: () => ({ literature_search: tool("Search research sources.") }),
        },
        {
          id: "mcp:papers",
          mode: "chat",
          source: { kind: "mcp", server: "Papers" },
          create: () => ({ search_papers: tool("Search the papers server.") }),
        },
        {
          id: "mcp:library",
          mode: "chat",
          source: { kind: "mcp", server: "Library" },
          create: () => ({ fetch_record: tool("Fetch a library record.") }),
        },
        {
          id: "figure-tools",
          mode: "chat",
          source: { kind: "figure" },
          create: () => ({ preview_figure: tool("Preview a figure.") }),
        },
      ],
      mode: "chat",
      createOpts: {},
      additions: [
        {
          id: "skills",
          source: { kind: "skills" },
          tools: { load_skill: tool("Load an enabled skill.") },
        } satisfies RuntimeToolset,
      ],
    });

    expect(Object.keys(resolved.tools)).toEqual([
      "read_file",
      "literature_search",
      "search_papers",
      "fetch_record",
      "preview_figure",
      "load_skill",
    ]);
    expect(resolved.groups.map(({ label, server, tools }) => ({
      label,
      server,
      tools: tools.map((entry) => entry.name),
    }))).toEqual([
      { label: "Project tools", server: undefined, tools: ["read_file", "literature_search"] },
      { label: "MCP", server: "Papers", tools: ["search_papers"] },
      { label: "MCP", server: "Library", tools: ["fetch_record"] },
      { label: "Figure", server: undefined, tools: ["preview_figure"] },
      { label: "Skills", server: undefined, tools: ["load_skill"] },
    ]);
  });

  it("keeps the figure group out of a run that excludes the figure tools", () => {
    const resolved = resolveAvailableTools({
      toolsets: [
        {
          id: "project-tools",
          mode: "chat",
          source: { kind: "project" },
          create: () => ({ read_file: tool("Read a project file.") }),
        },
        {
          id: "figure-tools",
          mode: "chat",
          source: { kind: "figure" },
          create: () => ({
            preview_figure: tool("Preview a figure."),
            insert_figure: tool("Insert a figure."),
            load_image: tool("Load an image."),
          }),
        },
      ],
      mode: "chat",
      createOpts: {},
      excludedNames: ["preview_figure", "insert_figure", "load_image"],
    });

    expect(Object.keys(resolved.tools)).toEqual(["read_file"]);
    expect(resolved.groups.map((group) => group.label)).toEqual(["Project tools"]);
  });

  it("keeps resolving when one active contribution fails to initialize", () => {
    const resolved = resolveAvailableTools({
      toolsets: [
        {
          id: "broken-tools",
          mode: "chat",
          create: () => {
            throw new Error("tool factory failed");
          },
        },
        {
          id: "project-tools",
          mode: "chat",
          create: () => ({ read_file: tool("Read a project file.") }),
        },
      ],
      mode: "chat",
      createOpts: {},
    });

    expect(Object.keys(resolved.tools)).toEqual(["read_file"]);
    expect(resolved.groups[0].tools).toEqual([
      { name: "read_file", description: "Read a project file." },
    ]);
  });

  it("filters schemas and grouped entries through the same enabled map", () => {
    const resolved = resolveAvailableTools({
      toolsets: [
        {
          id: "mcp:papers",
          mode: "chat",
          source: { kind: "mcp", server: "Papers" },
          create: () => ({
            search_papers: tool("Search papers."),
            fetch_paper: tool("Fetch a paper."),
          }),
        },
      ],
      mode: "chat",
      createOpts: {},
    });

    const filtered = filterResolvedTools(resolved, { search_papers: false });

    expect(Object.keys(filtered.tools)).toEqual(["fetch_paper"]);
    expect(filtered.groups[0].tools.map((entry) => entry.name)).toEqual(["fetch_paper"]);
  });
});
