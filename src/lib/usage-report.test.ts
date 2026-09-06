import { describe, expect, it } from "vitest";
import {
  activeQuickRange,
  createUsageReportFilter,
  DAY_MS,
  fillDailySeries,
  usageQuickRange,
  usageReportCsv,
  usageReportCsvFilename,
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
      childRunCount: 0,
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
      unpricedRecords: 0,
      planRecords: 0,
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
        unmeasuredRecords: 0,
      },
    ],
    heatmap: [],
    byProject: [
      {
        key: "project",
        inputTotal: 10,
        outputTotal: 4,
        cacheReadTotal: 2,
        estimatedCostUsd: 0.01,
        recordCount: 1,
        sessionCount: 1,
        unmeasuredRecords: 0,
        unpricedRecords: 0,
        planRecords: 0,
      },
    ],
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
          unmeasuredRecords: 0,
          unpricedRecords: 0,
          planRecords: 0,
          scope: "session",
          status: "completed",
          measurement: "provider_reported",
          billingMode: "api",
        },
      ],
    },
  };
}

describe("usage report client", () => {
  it("creates a default filter aligned to whole UTC days", () => {
    const now = 40 * DAY_MS + 16 * 3_600_000;
    const filter = createUsageReportFilter({}, now);
    expect(filter.startMs).toBe(11 * DAY_MS);
    expect(filter.endMs).toBe(41 * DAY_MS);
    expect(filter.pageSize).toBe(25);
    expect(activeQuickRange(filter, now)).toBe("30d");
  });

  it("computes quick ranges that end at the next UTC midnight", () => {
    const now = Date.UTC(2026, 8, 5, 16, 3);
    expect(usageQuickRange("7d", now)).toEqual({
      startMs: Date.UTC(2026, 7, 30),
      endMs: Date.UTC(2026, 8, 6),
    });
    expect(usageQuickRange("90d", now).startMs).toBe(Date.UTC(2026, 8, 6) - 90 * DAY_MS);
    expect(usageQuickRange("month", now)).toEqual({
      startMs: Date.UTC(2026, 8, 1),
      endMs: Date.UTC(2026, 8, 6),
    });
    expect(
      activeQuickRange({ startMs: Date.UTC(2026, 7, 1), endMs: Date.UTC(2026, 8, 6) }, now),
    ).toBeNull();
  });

  it("fills missing days with zero-count points across the whole range", () => {
    const series = fillDailySeries({
      startMs: Date.UTC(2026, 7, 30, 5),
      endMs: Date.UTC(2026, 8, 3),
      daily: [
        {
          day: "2026-08-31",
          inputTotal: 5,
          outputTotal: 1,
          cacheReadTotal: 0,
          estimatedCostUsd: null,
          recordCount: 1,
          unmeasuredRecords: 0,
        },
        {
          day: "2026-09-02",
          inputTotal: null,
          outputTotal: null,
          cacheReadTotal: null,
          estimatedCostUsd: null,
          recordCount: 2,
          unmeasuredRecords: 2,
        },
      ],
    });
    expect(series.map((point) => point.day)).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ]);
    expect(series[0]).toMatchObject({ inputTotal: 0, outputTotal: 0, recordCount: 0 });
    expect(series[1].inputTotal).toBe(5);
    expect(series[3].inputTotal).toBeNull();
    expect(fillDailySeries({ startMs: 0, endMs: 1, daily: [] })).toHaveLength(1);
  });

  it("names the export after the inclusive UTC day range", () => {
    expect(
      usageReportCsvFilename({ startMs: Date.UTC(2026, 7, 6), endMs: Date.UTC(2026, 8, 6) }),
    ).toBe("oleafly-usage-2026-08-06-2026-09-05.csv");
  });

  it("exports totals, breakdowns, counters and session metadata without conversation text", () => {
    const csv = usageReportCsv(report());
    expect(csv).toContain('"session,one"');
    expect(csv).toContain("Totals\r\nInput tokens,10\r\n");
    expect(csv).toContain("Child runs,0");
    expect(csv).toContain("Projects\r\nName,Input tokens");
    expect(csv).toContain("project,10,4,2,0.01,1,1,0,0,0");
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

  it.each([
    ["equals", "=1+1"],
    ["plus", "+1+1"],
    ["minus", "-1"],
    ["at sign", "@SUM(1)"],
    ["full-width equals", "＝1+1"],
    ["full-width plus", "＋1+1"],
    ["full-width minus", "－1"],
    ["full-width at sign", "＠SUM(1)"],
    ["leading spaces", "  =1+1"],
    ["leading Unicode whitespace", "\u00a0\u3000＋1+1"],
    ["leading tab", "\tmodel"],
    ["leading carriage return", "\rmodel"],
    ["leading line feed", "\nmodel"],
    ["space before a control character", " \tmodel"],
    ["mixed whitespace and controls", " \t\r\n=1+1"],
    ["leading null", "\u0000=1+1"],
    ["leading delete", "\u007f=1+1"],
    ["leading format character", "\u200b=1+1"],
  ])("exports %s metadata as literal text", (_name, value) => {
    const unsafe = report();
    Object.assign(unsafe.sessions.items[0], {
      sessionId: value,
      projectId: value,
      runtimeId: value,
      providerId: value,
      modelId: value,
      priceVersion: value,
    });

    const csv = usageReportCsv(unsafe);
    const literal = `"'${value}"`;
    expect(csv).toContain(
      `${literal},${literal},${literal},${literal},${literal},1970-01-01T00:00:00.000Z,10,4,2,0,0.01,${literal},completed,provider_reported,api\r\n`,
    );
  });

  it("keeps quotes, delimiters and line breaks inside a protected metadata cell", () => {
    const unsafe = report();
    unsafe.sessions.items[0].modelId = '=HYPERLINK("https://example.invalid","model");\r\n=1+1';

    expect(usageReportCsv(unsafe)).toContain(
      '"session,one",project,built-in,provider,"\'=HYPERLINK(""https://example.invalid"",""model"");\r\n=1+1",1970-01-01T00:00:00.000Z,10,4,2,0,0.01,model-metadata:test,completed,provider_reported,api\r\n',
    );
  });

  it("preserves numeric cells while protecting numeric-looking metadata", () => {
    const numeric = report();
    numeric.sessions.items[0].modelId = "-1";
    numeric.sessions.items[0].outputTotal = 0;

    const csv = usageReportCsv(numeric);
    expect(csv).toContain("1970-01-01,10,4,2,0.01,1\r\n");
    expect(csv).toContain(
      '"session,one",project,built-in,provider,"\'-1",1970-01-01T00:00:00.000Z,10,0,2,0,0.01,model-metadata:test,completed,provider_reported,api\r\n',
    );
  });

  it("preserves ordinary model identifiers and absent metadata", () => {
    const ordinary = report();
    ordinary.sessions.items[0].modelId = "family/model-1+variant@latest";
    ordinary.sessions.items[0].providerId = null;
    ordinary.sessions.items[0].priceVersion = null;

    expect(usageReportCsv(ordinary)).toContain(
      '"session,one",project,built-in,,family/model-1+variant@latest,1970-01-01T00:00:00.000Z,10,4,2,0,0.01,,completed,provider_reported,api\r\n',
    );
  });
});
