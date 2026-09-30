export type AiSettingsTab = "providers" | "agents" | "instructions" | "personas" | "skills" | "mcp";

export interface AiSettingsDestination {
  tab: AiSettingsTab;
  elementId?: string;
  /** A CLI agent whose card the Agents tab expands and scrolls to. */
  agentId?: string;
}

const AGENT_TARGET_PREFIX = "ai-agents:";

/** The settings target that opens the Agents tab, optionally on one agent's card. */
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
  if (scrollTarget === "ai-approvals") {
    return { tab: "providers", elementId: "ai-project-approvals" };
  }
  return null;
}
