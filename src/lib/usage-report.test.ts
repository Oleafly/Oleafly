import { describe, expect, it } from "vitest";
import {
  createUsageReportFilter,
  parseUsageFilterValues,
  usageReportCsv,
  type UsageReport,
} from "./usage-report";

function report(): UsageReport {
  return {
    startMs: 0,
    endMs: 1,
    timezone: "UTC",
    generatedAtMs: 1,
    totals: {
      recordCount: 1,
      sessionCount: 1,
      inputTotal: 10,
      inputKnownRecords: 1,
      inputUnknownRecords: 0,
      inputFresh: 8,
      inputFreshKnownRecords: 1,
      outputTotal: 4,
      outputKnownRecords: 1,
      outputUnknownRecords: 0,
      cacheReadTotal: 2,
      cacheWriteTotal: 0,
      cacheKnownRecords: 1,
      cacheUnknownRecords: 0,
      cacheRate: 0.2,
      estimatedCostUsd: 0.01,
      costKnownRecords: 1,
      costUnknownRecords: 0,
      reportedRecords: 1,
      estimatedRecords: 0,
      unavailableRecords: 0,
      excludedChildRecords: 0,
    },
    daily: [
      {
        day: "1970-01-01",
        inputTotal: 10,
        outputTotal: 4,
        cacheReadTotal: 2,
        estimatedCostUsd: 0.01,
        recordCount: 1,
      },
    ],
    heatmap: [],
    byProject: [],
    byRuntime: [],
    byProvider: [],
    byModel: [],
    sessions: {
      page: 0,
      pageSize: 25,
      total: 1,
      items: [
        {
          sessionId: "session,one",
          projectId: "project",
          runtimeId: "built-in",
          providerId: "provider",
          modelId: "model",
          occurredAtMs: 0,
          inputTotal: 10,
          outputTotal: 4,
          cacheReadTotal: 2,
          cacheWriteTotal: 0,
          estimatedCostUsd: 0.01,
          priceVersion: "model-metadata:test",
          recordCount: 1,
          status: "completed",
          measurement: "provider_reported",
          billingMode: "api",
        },
      ],
    },
  };
}

describe("usage report client", () => {
  it("creates a bounded default filter", () => {
    const filter = createUsageReportFilter({}, 40 * 86_400_000);
    expect(filter.startMs).toBe(10 * 86_400_000);
    expect(filter.endMs).toBe(40 * 86_400_000 + 1);
    expect(filter.pageSize).toBe(25);
  });

  it("exports counters and session metadata without conversation text", () => {
    const csv = usageReportCsv(report());
    expect(csv).toContain('"session,one"');
    expect(csv).toContain("Cache read tokens");
    expect(csv).toContain("Current page 1; 1 of 1 matching sessions");
    expect(csv).toContain("provider_reported");
    expect(csv).not.toContain("prompt");
  });

  it("exports missing counters as blank cells", () => {
    const unknown = report();
    unknown.daily[0].inputTotal = null;
    unknown.daily[0].outputTotal = null;
    unknown.sessions.items[0].inputTotal = null;
    unknown.sessions.items[0].outputTotal = null;

    const csv = usageReportCsv(unknown);
    expect(csv).toContain("1970-01-01,,,2,0.01,1");
    expect(csv).toContain("1970-01-01T00:00:00.000Z,,,2,0,0.01");
  });

  it("parses distinct comma-separated filter values", () => {
    expect(parseUsageFilterValues(" one, two,one,  ")).toEqual(["one", "two"]);
  });
});
