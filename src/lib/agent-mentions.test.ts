import { describe, expect, it } from "vitest";
import { agentDelegationPrompt, mentionedAgents, type DelegationTarget } from "./agent-mentions";

const targets: DelegationTarget[] = [{ id: "claude", label: "Claude", detail: "CLI agent", runtime: "acp", agentId: "claude" }];

describe("agent mentions", () => {
  it("only delegates to configured targets and deduplicates mentions", () => {
    expect(mentionedAgents("@claude, review this. @unknown @claude", targets)).toEqual(targets);
    expect(agentDelegationPrompt("@unknown", targets)).toBe("");
    expect(agentDelegationPrompt("@claude review", targets)).toContain('"agentId":"claude"');
  });
});
