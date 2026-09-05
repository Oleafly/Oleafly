import { invoke } from "@tauri-apps/api/core";

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

export type UsageEventInput = {
  eventId: string;
  sourceId: string;
  sourceTurnId: string;
  projectId: string;
  taskId?: string | null;
  sessionId: string;
  parentSessionId?: string | null;
  parentRecordKey?: string | null;
  runtimeId: string;
  providerId?: string | null;
  modelId?: string | null;
  occurredAtMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  inputSemantics: UsageInputSemantics;
  counterSemantics: UsageCounterSemantics;
  measurement: UsageMeasurement;
  billingMode: UsageBillingMode;
  estimatedCostUsd?: number | null;
  priceVersion?: string | null;
  durationMs?: number | null;
  status: UsageTurnStatus;
  aggregationScope?: "self" | "includes_children";
};

export type UsageRecordResult = {
  recordKey: string;
  inserted: boolean;
};

export type UsageEstimateInput = {
  sourceId: string;
  sourceTurnId: string;
};

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

export function createUsageReportFilter(
  overrides: Partial<UsageReportFilter> = {},
  now = Date.now(),
): UsageReportFilter {
  return {
    startMs: now - 30 * 86_400_000,
    endMs: now + 1,
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

export const recordUsageEvent = (event: UsageEventInput) =>
  invoke<UsageRecordResult>("record_usage_event", { event });

export const queryUsageReport = (filter: UsageReportFilter) =>
  invoke<UsageReport>("usage_report_query", { filter });

export const updateUsageEstimate = (estimate: UsageEstimateInput) =>
  invoke<boolean>("usage_estimate_update", { estimate });

export function parseUsageFilterValues(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function csvCell(value: string | number): string {
  const literal = typeof value === "string" && /^[\s\p{Cc}\p{Cf}]*[=+\-@＝＋－＠\p{Cc}\p{Cf}]/u.test(value);
  const text = literal ? `'${value}` : String(value);
  return literal || /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function usageReportCsv(report: UsageReport): string {
  const rows: Array<Array<string | number>> = [
    ["Usage report", `${new Date(report.startMs).toISOString()} to ${new Date(report.endMs).toISOString()}`],
    ["Timezone", report.timezone],
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

export function downloadUsageReportCsv(report: UsageReport): void {
  const blob = new Blob([usageReportCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `oleafly-usage-${new Date(report.startMs).toISOString().slice(0, 10)}-${new Date(report.endMs).toISOString().slice(0, 10)}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
