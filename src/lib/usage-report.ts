import { invoke, isTauri } from "@tauri-apps/api/core";
import { pickSavePath } from "@/lib/native-file-dialog";
import { uint8ToBase64, writeBytesFile } from "@/lib/tauri";

export type UsageInputSemantics = "inclusive" | "exclusive" | "unknown";
export type UsageCounterSemantics = "delta" | "cumulative";
export type UsageMeasurement =
  | "provider_reported"
  | "runtime_reported"
  | "estimated"
  | "unavailable";
export type UsageBillingMode = "api" | "subscription" | "local" | "unknown";
export type UsageTurnStatus =
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export type UsageSessionScope = "session" | "child" | "task" | "helper";

export type UsageReportFilter = {
  startMs: number;
  endMs: number;
  projectIds: string[];
  runtimeIds: string[];
  providerIds: string[];
  modelIds: string[];
  sessionIds: string[];
  page: number;
  pageSize: number;
};

export type UsageReportTotals = {
  recordCount: number;
  sessionCount: number;
  childRunCount: number;
  inputTotal: number;
  inputKnownRecords: number;
  inputUnknownRecords: number;
  inputFresh: number;
  inputFreshKnownRecords: number;
  outputTotal: number;
  outputKnownRecords: number;
  outputUnknownRecords: number;
  cacheReadTotal: number;
  cacheWriteTotal: number;
  cacheKnownRecords: number;
  cacheUnknownRecords: number;
  cacheRate: number | null;
  estimatedCostUsd: number;
  costKnownRecords: number;
  costUnknownRecords: number;
  unpricedRecords: number;
  planRecords: number;
  reportedRecords: number;
  estimatedRecords: number;
  unavailableRecords: number;
  excludedChildRecords: number;
};

export type UsageTrendPoint = {
  day: string;
  inputTotal: number | null;
  outputTotal: number | null;
  cacheReadTotal: number | null;
  estimatedCostUsd: number | null;
  recordCount: number;
  unmeasuredRecords: number;
};

export type UsageHeatmapCell = {
  weekday: number;
  hour: number;
  tokenTotal: number | null;
  recordCount: number;
};

export type UsageBreakdown = {
  key: string;
  inputTotal: number | null;
  outputTotal: number | null;
  cacheReadTotal: number | null;
  estimatedCostUsd: number | null;
  recordCount: number;
  sessionCount: number;
  unmeasuredRecords: number;
  unpricedRecords: number;
  planRecords: number;
};

export type UsageSessionDetail = {
  sessionId: string;
  projectId: string;
  runtimeId: string;
  providerId: string | null;
  modelId: string | null;
  occurredAtMs: number;
  inputTotal: number | null;
  outputTotal: number | null;
  cacheReadTotal: number | null;
  cacheWriteTotal: number | null;
  estimatedCostUsd: number | null;
  priceVersion: string | null;
  recordCount: number;
  unmeasuredRecords: number;
  unpricedRecords: number;
  planRecords: number;
  scope: UsageSessionScope | string;
  status: string;
  measurement: string;
  billingMode: string;
};

export type UsageSessionPage = {
  items: UsageSessionDetail[];
  page: number;
  pageSize: number;
  total: number;
};

export type UsageReport = {
  startMs: number;
  endMs: number;
  timezone: "UTC";
  generatedAtMs: number;
  totals: UsageReportTotals;
  daily: UsageTrendPoint[];
  heatmap: UsageHeatmapCell[];
  byProject: UsageBreakdown[];
  byRuntime: UsageBreakdown[];
  byProvider: UsageBreakdown[];
  byModel: UsageBreakdown[];
  sessions: UsageSessionPage;
};

export type UsageQuickRange = "7d" | "30d" | "90d" | "month";

export const DAY_MS = 86_400_000;
export const USAGE_QUICK_RANGES: ReadonlyArray<{ id: UsageQuickRange }> = [
  { id: "7d" },
  { id: "30d" },
  { id: "90d" },
  { id: "month" },
];

export function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function msFromIsoDay(day: string): number | null {
  const parsed = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

export function usageQuickRange(
  range: UsageQuickRange,
  now = Date.now(),
): { startMs: number; endMs: number } {
  const today = utcDayStart(now);
  const endMs = today + DAY_MS;
  if (range === "month") {
    const date = new Date(today);
    return { startMs: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1), endMs };
  }
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return { startMs: today - (days - 1) * DAY_MS, endMs };
}

export function activeQuickRange(
  filter: Pick<UsageReportFilter, "startMs" | "endMs">,
  now = Date.now(),
): UsageQuickRange | null {
  for (const { id } of USAGE_QUICK_RANGES) {
    const range = usageQuickRange(id, now);
    if (range.startMs === filter.startMs && range.endMs === filter.endMs) return id;
  }
  return null;
}

export function createUsageReportFilter(
  overrides: Partial<UsageReportFilter> = {},
  now = Date.now(),
): UsageReportFilter {
  return {
    ...usageQuickRange("30d", now),
    projectIds: [],
    runtimeIds: [],
    providerIds: [],
    modelIds: [],
    sessionIds: [],
    page: 0,
    pageSize: 25,
    ...overrides,
  };
}

export const queryUsageReport = (filter: UsageReportFilter) =>
  invoke<UsageReport>("usage_report_query", { filter });

export function fillDailySeries(
  report: Pick<UsageReport, "startMs" | "endMs" | "daily">,
): UsageTrendPoint[] {
  const known = new Map(report.daily.map((point) => [point.day, point]));
  const first = utcDayStart(report.startMs);
  const last = utcDayStart(Math.max(report.startMs, report.endMs - 1));
  const series: UsageTrendPoint[] = [];
  for (let ms = first; ms <= last; ms += DAY_MS) {
    const day = isoDay(ms);
    series.push(
      known.get(day) ?? {
        day,
        inputTotal: 0,
        outputTotal: 0,
        cacheReadTotal: 0,
        estimatedCostUsd: 0,
        recordCount: 0,
        unmeasuredRecords: 0,
      },
    );
  }
  return series;
}

function csvCell(value: string | number): string {
  const literal = typeof value === "string" && /^[\s\p{Cc}\p{Cf}]*[=+\-@＝＋－＠\p{Cc}\p{Cf}]/u.test(value);
  const text = literal ? `'${value}` : String(value);
  return literal || /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function breakdownRows(title: string, rows: UsageBreakdown[]): Array<Array<string | number>> {
  return [
    [],
    [title],
    [
      "Name",
      "Input tokens",
      "Output tokens",
      "Cache read tokens",
      "Estimated cost USD",
      "Records",
      "Sessions",
      "Unmeasured records",
      "Unpriced records",
      "Plan records",
    ],
    ...rows.map((row) => [
      row.key,
      row.inputTotal ?? "",
      row.outputTotal ?? "",
      row.cacheReadTotal ?? "",
      row.estimatedCostUsd ?? "",
      row.recordCount,
      row.sessionCount,
      row.unmeasuredRecords,
      row.unpricedRecords,
      row.planRecords,
    ]),
  ];
}

export function usageReportCsv(report: UsageReport): string {
  const totals = report.totals;
  const rows: Array<Array<string | number>> = [
    ["Usage report", `${new Date(report.startMs).toISOString()} to ${new Date(report.endMs).toISOString()}`],
    ["Timezone", report.timezone],
    [],
    ["Totals"],
    ["Input tokens", totals.inputTotal],
    ["Output tokens", totals.outputTotal],
    ["Cache read tokens", totals.cacheReadTotal],
    ["Cache write tokens", totals.cacheWriteTotal],
    ["Estimated cost USD", totals.estimatedCostUsd],
    ["Priced records", totals.costKnownRecords],
    ["Unpriced records", totals.unpricedRecords],
    ["Plan or local records", totals.planRecords],
    ["Sessions", totals.sessionCount],
    ["Child runs", totals.childRunCount],
    ["Records", totals.recordCount],
    [],
    ["Day", "Input tokens", "Output tokens", "Cache read tokens", "Estimated cost USD", "Records"],
    ...report.daily.map((point) => [
      point.day,
      point.inputTotal ?? "",
      point.outputTotal ?? "",
      point.cacheReadTotal ?? "",
      point.estimatedCostUsd ?? "",
      point.recordCount,
    ]),
    ...breakdownRows("Projects", report.byProject),
    ...breakdownRows("Agents", report.byRuntime),
    ...breakdownRows("Providers", report.byProvider),
    ...breakdownRows("Models", report.byModel),
    [],
    [
      "Session detail",
      `Current page ${report.sessions.page + 1}; ${report.sessions.items.length} of ${report.sessions.total} matching sessions`,
    ],
    [
      "Session",
      "Project",
      "Agent",
      "Provider",
      "Model",
      "Last activity UTC",
      "Input tokens",
      "Output tokens",
      "Cache read tokens",
      "Cache write tokens",
      "Estimated cost USD",
      "Price source",
      "Status",
      "Measurement",
      "Billing mode",
    ],
    ...report.sessions.items.map((session) => [
      session.sessionId,
      session.projectId,
      session.runtimeId,
      session.providerId ?? "",
      session.modelId ?? "",
      new Date(session.occurredAtMs).toISOString(),
      session.inputTotal ?? "",
      session.outputTotal ?? "",
      session.cacheReadTotal ?? "",
      session.cacheWriteTotal ?? "",
      session.estimatedCostUsd ?? "",
      session.priceVersion ?? "",
      session.status,
      session.measurement,
      session.billingMode,
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function usageReportCsvFilename(report: Pick<UsageReport, "startMs" | "endMs">): string {
  const lastDay = isoDay(Math.max(report.startMs, report.endMs - 1));
  return `oleafly-usage-${isoDay(report.startMs)}-${lastDay}.csv`;
}

export async function saveUsageReportCsv(report: UsageReport): Promise<string | null> {
  const csv = usageReportCsv(report);
  const filename = usageReportCsvFilename(report);
  if (!isTauri()) {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = "noopener";
      anchor.click();
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    return null;
  }
  const destination = await pickSavePath({
    defaultPath: filename,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!destination) return null;
  await writeBytesFile(destination, uint8ToBase64(new TextEncoder().encode(csv)));
  return destination;
}
