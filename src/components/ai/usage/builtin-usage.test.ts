import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/ai.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  providerCredit: vi.fn(),
  budgetGet: vi.fn(),
  usageSummary: vi.fn(),
  queryUsageReport: vi.fn(),
}));

vi.mock("@/lib/agent-backend", () => ({ providerCredit: mocks.providerCredit }));
vi.mock("@/lib/tauri", () => ({ budgetGet: mocks.budgetGet, usageSummary: mocks.usageSummary }));
vi.mock("@/lib/usage-report", () => ({
  queryUsageReport: mocks.queryUsageReport,
  createUsageReportFilter: (overrides: Record<string, unknown>) => ({ ...overrides }),
}));

import { builtinUsageExtras, builtinUsageSnapshot } from "./builtin-usage";

beforeAll(async () => {
  const { initTestI18n } = await import("@/components/ai/acp/tests/ui-fixtures");
  await initTestI18n();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("built-in usage", () => {
  it("builds the snapshot from chat totals, the last run and the context", () => {
    const snapshot = builtinUsageSnapshot({
      chatUsage: { inputTokens: 100, outputTokens: 20, steps: 3, runs: 2, estimatedUsd: 0.5, cacheReadTokens: 40 },
      runUsage: { input: 60, output: null, steps: 2 },
      context: { used: 1000, size: 200_000 },
    });
    expect(snapshot.context).toEqual({ used: 1000, size: 200_000 });
    expect(snapshot.lastTurn).toEqual({ inputTokens: 60, outputTokens: undefined, steps: 2 });
    expect(snapshot.session).toMatchObject({ inputTokens: 100, turns: 2, steps: 3, costUsd: 0.5, cachedReadTokens: 40 });
    expect(snapshot.notes).toEqual([en.usage.cacheNote]);
  });

  it("adds a note when the history was trimmed", () => {
    const snapshot = builtinUsageSnapshot({ droppedTurns: 4 });
    expect(snapshot.notes?.[0]).toBe(en.usage.historyTrimmed_other.replace("{{count}}", "24"));
  });

  it("loads budget, credit and chat cost, keeping what succeeded", async () => {
    mocks.budgetGet.mockResolvedValue(10);
    mocks.usageSummary.mockResolvedValue({ input_tokens: 1, output_tokens: 1, cost_usd: 2.5 });
    mocks.providerCredit.mockRejectedValue(new Error("offline"));
    mocks.queryUsageReport.mockResolvedValue({ totals: { costKnownRecords: 3, estimatedCostUsd: 0.75 } });
    const extras = await builtinUsageExtras({
      projectId: "p1",
      providerId: "openrouter",
      threadId: "t1",
      chatCreatedAt: Date.now(),
    })();
    expect(extras.budget).toEqual({ spentUsd: 2.5, limitUsd: 10 });
    expect(extras.credit).toBeUndefined();
    expect(extras.session).toEqual({ costUsd: 0.75 });
    expect(mocks.queryUsageReport.mock.calls[0][0]).toMatchObject({ sessionIds: ["t1"], pageSize: 1 });
  });
});
