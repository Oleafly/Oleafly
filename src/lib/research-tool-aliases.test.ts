import { describe, expect, it } from "vitest";
import type { McpAgentServer } from "@/lib/tauri";
import { resolveResearchToolAliases, toolAliasNote } from "./research-tool-aliases";

const ALPHAXIV: McpAgentServer = {
  name: "alphaXiv",
  tools: [
    { name: "mcp_ext_alphaXiv_discover_papers_ab12", tool_handle: "discover_papers", description: null, input_schema: {} },
    { name: "mcp_ext_alphaXiv_get_paper_content_ab12", tool_handle: "get_paper_content", description: null, input_schema: {} },
  ],
};

describe("research tool aliases", () => {
  it("resolves alphaxiv_search to the connected alphaXiv discover tool", () => {
    expect(resolveResearchToolAliases([ALPHAXIV])).toEqual({
      alphaxiv_search: "mcp_ext_alphaXiv_discover_papers_ab12",
      alphaxiv_paper_content: "mcp_ext_alphaXiv_get_paper_content_ab12",
    });
  });

  it("falls back to literature_search without the connector", () => {
    const resolved = resolveResearchToolAliases([{ name: "Zotero", tools: [] }]);
    expect(resolved).toEqual({ alphaxiv_search: "literature_search", alphaxiv_paper_content: null });
    const note = toolAliasNote("Use alphaxiv_search, then alphaxiv_paper_content.", resolved);
    expect(note).toContain('`alphaxiv_search` means `literature_search` with `sources: ["arxiv"]`.');
    expect(note).toContain("`alphaxiv_paper_content` means nothing here");
  });

  it("the note is empty when the skill names no alias", () => {
    expect(toolAliasNote("Search the bibliography.", resolveResearchToolAliases([ALPHAXIV]))).toBe("");
  });

  it("names the connected tools in the note", () => {
    expect(toolAliasNote("Call alphaxiv_search.", resolveResearchToolAliases([ALPHAXIV]))).toBe(
      "\n\nTool names in this skill: `alphaxiv_search` means `mcp_ext_alphaXiv_discover_papers_ab12`.",
    );
  });

  it("finds the alphaXiv server however its name is written and takes the next handle it offers", () => {
    const renamed: McpAgentServer = {
      name: "Alpha-Xiv (papers)",
      tools: [
        { name: "mcp_ext_papers_search_cd34", tool_handle: "search_papers", description: null, input_schema: {} },
        { name: "mcp_ext_papers_content_cd34", tool_handle: "paper_content", description: null, input_schema: {} },
      ],
    };

    expect(resolveResearchToolAliases([{ name: "Zotero", tools: [] }, renamed])).toEqual({
      alphaxiv_search: "mcp_ext_papers_search_cd34",
      alphaxiv_paper_content: "mcp_ext_papers_content_cd34",
    });
  });

  it("falls back for each alias the connected server has no tool for", () => {
    const searchOnly: McpAgentServer = { name: "alphaxiv", tools: [ALPHAXIV.tools[0]] };

    expect(resolveResearchToolAliases([searchOnly])).toEqual({
      alphaxiv_search: "mcp_ext_alphaXiv_discover_papers_ab12",
      alphaxiv_paper_content: null,
    });
  });

  it("points the search alias at literature_search when nothing resolves it", () => {
    expect(toolAliasNote("Call alphaxiv_search.", { alphaxiv_search: null, alphaxiv_paper_content: null })).toBe(
      "\n\nTool names in this skill: `alphaxiv_search` means `literature_search`.",
    );
  });
});
