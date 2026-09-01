import type { AiToolsetContribution, AiToolsetSource } from "@oleafly/registry";
import type { ToolSet } from "@/lib/chat-types";
import { isToolEnabled } from "@/store/ai-tool-settings";

export interface AvailableToolEntry {
  name: string;
  description: string;
}

export interface AvailableToolGroup {
  id: string;
  label: "Project tools" | "MCP" | "Skills" | "Figure";
  server?: string;
  tools: AvailableToolEntry[];
}

export interface RuntimeToolset {
  id: string;
  source: AiToolsetSource;
  tools: ToolSet;
}

export interface ResolvedAvailableTools {
  tools: ToolSet;
  groups: AvailableToolGroup[];
}

function inferredSource(toolset: AiToolsetContribution): AiToolsetSource {
  if (toolset.source) return toolset.source;
  if (toolset.id === "figure-tools") return { kind: "figure" };
  if (toolset.id.startsWith("mcp:")) {
    return { kind: "mcp", server: toolset.id.slice(4) || "MCP server" };
  }
  if (toolset.id.startsWith("skill")) return { kind: "skills" };
  return { kind: "project" };
}

function groupDetails(source: AiToolsetSource): Omit<AvailableToolGroup, "tools"> {
  if (source.kind === "mcp") {
    return { id: `mcp:${source.server}`, label: "MCP", server: source.server };
  }
  if (source.kind === "figure") return { id: "figure", label: "Figure" };
  if (source.kind === "skills") return { id: "skills", label: "Skills" };
  return { id: "project", label: "Project tools" };
}

function descriptionOf(tool: ToolSet[string]): string {
  return typeof tool.description === "string" ? tool.description.trim() : "";
}

export function resolveAvailableTools({
  toolsets,
  mode,
  createOpts,
  additions = [],
  excludedNames = [],
}: {
  toolsets: readonly AiToolsetContribution[];
  mode: string;
  createOpts: unknown;
  additions?: readonly RuntimeToolset[];
  excludedNames?: readonly string[];
}): ResolvedAvailableTools {
  const runtime: RuntimeToolset[] = [
    ...toolsets
      .filter((toolset) => toolset.mode === mode)
      .flatMap((toolset) => {
        try {
          return [{
            id: toolset.id,
            source: inferredSource(toolset),
            tools: toolset.create(createOpts) as ToolSet,
          }];
        } catch {
          return [];
        }
      }),
    ...additions,
  ];
  const excluded = new Set(excludedNames);
  const winners = new Map<
    string,
    { definition: ToolSet[string]; source: AiToolsetSource }
  >();
  for (const toolset of runtime) {
    for (const [name, definition] of Object.entries(toolset.tools)) {
      if (!excluded.has(name)) winners.set(name, { definition, source: toolset.source });
    }
  }

  const tools = Object.fromEntries(
    Array.from(winners, ([name, winner]) => [name, winner.definition]),
  );
  const groups = new Map<string, AvailableToolGroup>();
  for (const [name, winner] of winners) {
    const details = groupDetails(winner.source);
    const group = groups.get(details.id) ?? { ...details, tools: [] };
    group.tools.push({ name, description: descriptionOf(winner.definition) });
    groups.set(details.id, group);
  }
  return { tools, groups: Array.from(groups.values()) };
}

export function filterResolvedTools(
  resolved: ResolvedAvailableTools,
  enabledByName: Readonly<Record<string, boolean>>,
): ResolvedAvailableTools {
  return {
    tools: Object.fromEntries(
      Object.entries(resolved.tools).filter(([name]) =>
        isToolEnabled(enabledByName, name)
      ),
    ),
    groups: resolved.groups.flatMap((group) => {
      const tools = group.tools.filter((entry) =>
        isToolEnabled(enabledByName, entry.name)
      );
      return tools.length > 0 ? [{ ...group, tools }] : [];
    }),
  };
}
