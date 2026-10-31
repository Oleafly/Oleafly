import type { McpAgentServer } from "@/lib/tauri";

/**
 * Bundled skills name alphaXiv tools that exist nowhere. Each alias lists
 * the alphaXiv MCP tool handles it means, best first.
 */
export const RESEARCH_TOOL_ALIASES = {
  alphaxiv_search: ["discover_papers", "search_papers"],
  alphaxiv_paper_content: ["get_paper_content", "paper_content"],
} as const satisfies Record<string, readonly string[]>;

export type ResearchToolAlias = keyof typeof RESEARCH_TOOL_ALIASES;

const FALLBACK: Record<ResearchToolAlias, string | null> = {
  alphaxiv_search: "literature_search",
  alphaxiv_paper_content: null,
};

function isAlphaXiv(server: McpAgentServer): boolean {
  return server.name.toLowerCase().replace(/[^a-z]/g, "").includes("alphaxiv");
}

export function resolveResearchToolAliases(
  servers: readonly McpAgentServer[],
): Record<ResearchToolAlias, string | null> {
  const server = servers.find(isAlphaXiv);
  const resolve = (alias: ResearchToolAlias): string | null => {
    const handles: readonly string[] = RESEARCH_TOOL_ALIASES[alias];
    for (const handle of handles) {
      const tool = server?.tools.find((candidate) => candidate.tool_handle === handle);
      if (tool) return tool.name;
    }
    return FALLBACK[alias];
  };
  return { alphaxiv_search: resolve("alphaxiv_search"), alphaxiv_paper_content: resolve("alphaxiv_paper_content") };
}

function meaning(alias: ResearchToolAlias, tool: string | null): string {
  if (tool === "literature_search") return '`literature_search` with `sources: ["arxiv"]`';
  if (tool) return `\`${tool}\``;
  return alias === "alphaxiv_paper_content"
    ? "nothing here: work from the abstract that literature_search returns, or read the arXiv page with web_fetch when web access is on"
    : "`literature_search`";
}

export function toolAliasNote(
  instructions: string,
  resolved: Record<ResearchToolAlias, string | null>,
): string {
  const lines = (Object.keys(RESEARCH_TOOL_ALIASES) as ResearchToolAlias[])
    .filter((alias) => instructions.includes(alias))
    .map((alias) => `\`${alias}\` means ${meaning(alias, resolved[alias])}.`);
  return lines.length > 0 ? `\n\nTool names in this skill: ${lines.join(" ")}` : "";
}
