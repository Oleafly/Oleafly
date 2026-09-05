import { describe, expect, it } from "vitest";
import { activeAgentMention, agentDelegationPrompt, mentionedAgents, type DelegationTarget } from "./agent-mentions";

const targets: DelegationTarget[] = [{ id: "claude", label: "Claude", detail: "CLI agent", runtime: "acp", agentId: "claude" }];

describe("agent mentions", () => {
  it("uses the token at the caret and leaves email addresses alone", () => {
    expect(activeAgentMention("Compare @cla with this", 12)).toEqual({ query: "cla", start: 8, end: 12 });
    expect(activeAgentMention("person@claude", 13)).toBeNull();
  });
  it("only delegates to configured targets and deduplicates mentions", () => {
    expect(mentionedAgents("@claude, review this. @unknown @claude", targets)).toEqual(targets);
    expect(agentDelegationPrompt("@unknown", targets)).toBe("");
    expect(agentDelegationPrompt("@claude review", targets)).toContain('"agentId":"claude"');
  });
});
