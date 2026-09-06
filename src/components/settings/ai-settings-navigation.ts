export type AiSettingsTab = "providers" | "agents" | "instructions" | "personas" | "skills" | "mcp";

export interface AiSettingsDestination {
  tab: AiSettingsTab;
  elementId?: string;
}

export function aiSettingsDestination(
  scrollTarget: string | null,
): AiSettingsDestination | null {
  if (scrollTarget === "ai-personas") return { tab: "personas" };
  if (scrollTarget === "ai-agents") return { tab: "agents" };
  if (scrollTarget === "ai-skills") return { tab: "skills" };
  if (scrollTarget === "ai-mcp") return { tab: "mcp" };
  if (scrollTarget === "ai-approvals") {
    return { tab: "providers", elementId: "ai-project-approvals" };
  }
  return null;
}
