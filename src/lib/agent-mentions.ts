export interface DelegationTarget {
  id: string;
  label: string;
  detail: string;
  runtime: "built-in" | "acp";
  providerId?: string;
  modelId?: string;
  agentId?: string;
  taskUnavailableReason?: string | null;
}

export function activeAgentMention(text: string, caret: number) {
  const before = text.slice(0, Math.max(0, caret));
  const match = /(?:^|\s)@([^\s@]*)$/u.exec(before);
  if (!match) return null;
  return { query: match[1], start: before.length - match[1].length - 1, end: caret };
}

export function mentionedAgents(text: string, targets: readonly DelegationTarget[]) {
  const byId = new Map(targets.map((target) => [target.id, target]));
  const found = new Map<string, DelegationTarget>();
  for (const match of text.matchAll(/(?:^|\s)@([^\s@]+)/gu)) {
    const id = match[1].replace(/[,.!?;]+$/u, "");
    const target = byId.get(id);
    if (target) found.set(id, target);
  }
  return [...found.values()];
}

export function agentDelegationPrompt(text: string, targets: readonly DelegationTarget[]) {
  const selected = mentionedAgents(text, targets);
  if (!selected.length) return "";
  const choices = selected.map(({ id, runtime, providerId, modelId, agentId }) => ({
    mention: `@${id}`, runtime, providerId, modelId, agentId,
  }));
  return `\nThe user selected these delegation targets in their message. Use spawn_agent with the corresponding runtime and IDs for the work assigned to each target. Each child should receive a concrete research task and return its sources and findings. Wait for their results before synthesizing a final answer. If delegation is unavailable in this run, explain that limitation before proceeding. Target data: ${JSON.stringify(choices)}\n`;
}
