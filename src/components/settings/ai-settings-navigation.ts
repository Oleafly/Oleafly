export type AiSettingsTab = "providers" | "agents" | "instructions" | "personas" | "skills" | "mcp" | "tools";

export interface AiSettingsDestination {
  tab: AiSettingsTab;
  elementId?: string;
  agentId?: string;
}

const AGENT_TARGET_PREFIX = "ai-agents:";

export function aiAgentsTarget(agentId?: string | null): string {
  return agentId ? `${AGENT_TARGET_PREFIX}${agentId}` : "ai-agents";
}

export function aiSettingsDestination(
  scrollTarget: string | null,
): AiSettingsDestination | null {
  if (scrollTarget === "ai-personas") return { tab: "personas" };
  if (scrollTarget === "ai-agents") return { tab: "agents" };
  if (scrollTarget?.startsWith(AGENT_TARGET_PREFIX)) {
    const agentId = scrollTarget.slice(AGENT_TARGET_PREFIX.length);
    return agentId ? { tab: "agents", agentId } : { tab: "agents" };
  }
  if (scrollTarget === "ai-skills") return { tab: "skills" };
  if (scrollTarget === "ai-mcp") return { tab: "mcp" };
  if (scrollTarget === "ai-tools") return { tab: "tools" };
  if (scrollTarget === "ai-approvals") {
    return { tab: "providers", elementId: "ai-project-approvals" };
  }
  return null;
}
