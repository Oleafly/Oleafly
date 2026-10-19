import { beforeAll, describe, expect, it } from "vitest";
import { initTestI18n, session } from "./tests/ui-fixtures";
import { canRefreshPlan, rateLimitLabel, toUsageSnapshot, usageTooltip } from "./acp-usage";

beforeAll(async () => {
  await initTestI18n();
});

describe("CLI agent usage", () => {
  it("maps context, cost and tokens", () => {
    const snapshot = toUsageSnapshot({
      contextUsed: 50_000,
      contextSize: 200_000,
      costAmount: 0.42,
      costCurrency: "USD",
      sessionTokens: { inputTokens: 1000, outputTokens: 200, thoughtTokens: 50, cachedReadTokens: 300, cachedWriteTokens: 10 },
      lastTurn: { inputTokens: 100, outputTokens: 20, thoughtTokens: null },
    });
    expect(snapshot).toEqual({
      context: { used: 50_000, size: 200_000 },
      session: { inputTokens: 1000, outputTokens: 200, thoughtTokens: 50, cachedReadTokens: 300, cachedWriteTokens: 10, costUsd: 0.42 },
      lastTurn: { inputTokens: 100, outputTokens: 20, thoughtTokens: undefined },
    });
  });

  it("treats a cost without a currency as dollars and skips an empty context", () => {
    expect(toUsageSnapshot({ costAmount: 1.5, contextUsed: 10, contextSize: 0 })).toEqual({
      session: {
        inputTokens: undefined, outputTokens: undefined, thoughtTokens: undefined,
        cachedReadTokens: undefined, cachedWriteTokens: undefined, costUsd: 1.5,
      },
    });
    expect(toUsageSnapshot(null)).toEqual({});
    expect(toUsageSnapshot(undefined)).toEqual({});
    expect(toUsageSnapshot({ contextUsed: null, contextSize: 1000 })).toEqual({});
  });

  it("labels Claude's limit windows and their state", () => {
    const snapshot = toUsageSnapshot({
      auth: { kind: "subscription", label: "Claude account", plan: "Max 20x" },
      rateLimits: [
        { id: "five_hour", status: "allowed_warning", utilization: 0.82, resetsAt: 1_800_000_000_000 },
        { id: "seven_day", status: "allowed", utilization: 0.1 },
        { id: "seven_day_opus", status: "rejected" },
        { id: "seven_day_sonnet", status: "allowed" },
        { id: "overage", status: "allowed", utilization: 0.05 },
        { id: "team_monthly", status: "allowed_warning" },
      ],
    });
    expect(snapshot.plan).toEqual({
      label: "Max 20x",
      windows: [
        { id: "five_hour", label: "5-hour session", utilization: 0.82, resetsAt: 1_800_000_000_000, status: "warning" },
        { id: "seven_day", label: "Weekly, all models", utilization: 0.1, resetsAt: undefined, status: "ok" },
        { id: "seven_day_opus", label: "Weekly, Opus", utilization: 0, resetsAt: undefined, status: "blocked" },
        { id: "overage", label: "Extra usage", utilization: 0.05, resetsAt: undefined, status: "ok" },
        { id: "team_monthly", label: "Usage limit team_monthly", utilization: 0, resetsAt: undefined, status: "warning" },
      ],
    });
    expect(rateLimitLabel("seven_day_sonnet")).toBe("Weekly, Sonnet");
  });

  it("names the plan by its label when the agent gives no plan name", () => {
    const snapshot = toUsageSnapshot({
      auth: { kind: "api_key", label: "API key" },
      rateLimits: [{ id: "five_hour", status: "allowed", utilization: 0.5 }],
    });
    expect(snapshot.plan?.label).toBe("API key");
    expect(toUsageSnapshot({ rateLimits: [{ id: "five_hour", status: "allowed", utilization: 0.5 }] }).plan?.label).toBeUndefined();
  });

  it("leaves non-USD cost out of the total and says so", () => {
    const snapshot = toUsageSnapshot({ costAmount: 3.5, costCurrency: "EUR" });
    expect(snapshot.session).toBeUndefined();
    expect(snapshot.notes).toEqual(["The agent reported a cost of 3.5 EUR."]);
    const withTokens = toUsageSnapshot({ costAmount: 3.5, costCurrency: "EUR", sessionTokens: { inputTokens: 10 } });
    expect(withTokens.session).toMatchObject({ inputTokens: 10, costUsd: undefined });
  });

  it("lists the tokens of up to four models", () => {
    const snapshot = toUsageSnapshot({
      modelUsage: ["opus", "sonnet", "haiku", "fast", "fifth"].map((model) => ({
        model,
        tokens: { inputTokens: 1000, outputTokens: model === "opus" ? 200 : null },
      })),
    });
    expect(snapshot.notes).toEqual([
      "opus: 1,200 tokens",
      "sonnet: 1,000 tokens",
      "haiku: 1,000 tokens",
      "fast: 1,000 tokens",
    ]);
  });

  it("keeps the plan text the agent printed", () => {
    expect(toUsageSnapshot({ planMarkdown: "**Max plan**: 82% used" }).planMarkdown).toBe("**Max plan**: 82% used");
  });

  it("offers plan refresh only when the agent has /usage or /status", () => {
    expect(canRefreshPlan(session("s", { availableCommands: [{ name: "usage", description: "", hint: null }] }))).toBe(true);
    expect(canRefreshPlan(session("s", { availableCommands: [{ name: "status", description: "", hint: null }] }))).toBe(true);
    expect(canRefreshPlan(session("s", { availableCommands: [{ name: "plan", description: "", hint: null }] }))).toBe(false);
    expect(canRefreshPlan(session("s"))).toBe(false);
  });

  it("says how much of the context is used in the tooltip", () => {
    expect(usageTooltip({ context: { used: 50, size: 200 } })).toBe("25% of the context window used");
    expect(usageTooltip({ context: { used: 50, size: 0 } })).toBe("Usage for this conversation");
    expect(usageTooltip({})).toBe("Usage for this conversation");
  });
});
