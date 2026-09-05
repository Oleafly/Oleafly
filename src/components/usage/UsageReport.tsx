import { useId, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createUsageReportFilter,
  downloadUsageReportCsv,
  parseUsageFilterValues,
  queryUsageReport,
  type UsageBreakdown,
  type UsageReport as UsageReportData,
  type UsageReportFilter,
} from "@/lib/usage-report";

type ReportQuery = (filter: UsageReportFilter) => Promise<UsageReportData>;

type UsageReportDialogProps = {
  trigger: ReactNode;
  initialFilter?: Partial<UsageReportFilter>;
  query?: ReportQuery;
};

type UsageReportProps = {
  report: UsageReportData;
  onExport?: (report: UsageReportData) => void;
};

type DraftFilter = {
  start: string;
  end: string;
  project: string;
  runtime: string;
  provider: string;
  model: string;
  session: string;
};

const DAY_MS = 86_400_000;
const WEEKDAYS = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];
const HOURS = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
];

function dateInputValue(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function draftFromFilter(filter: UsageReportFilter): DraftFilter {
  return {
    start: dateInputValue(filter.startMs),
    end: dateInputValue(Math.max(filter.startMs, filter.endMs - 1)),
    project: filter.projectIds.join(", "),
    runtime: filter.runtimeIds.join(", "),
    provider: filter.providerIds.join(", "),
    model: filter.modelIds.join(", "),
    session: filter.sessionIds.join(", "),
  };
}

function filterFromDraft(draft: DraftFilter, previous: UsageReportFilter): UsageReportFilter {
  const startMs = Date.parse(`${draft.start}T00:00:00.000Z`);
  const selectedEndMs = Date.parse(`${draft.end}T00:00:00.000Z`);
  return {
    ...previous,
    startMs: Number.isFinite(startMs) ? startMs : previous.startMs,
    endMs: Number.isFinite(selectedEndMs) ? selectedEndMs + DAY_MS : previous.endMs,
    projectIds: parseUsageFilterValues(draft.project),
    runtimeIds: parseUsageFilterValues(draft.runtime),
    providerIds: parseUsageFilterValues(draft.provider),
    modelIds: parseUsageFilterValues(draft.model),
    sessionIds: parseUsageFilterValues(draft.session),
    page: 0,
  };
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatCost(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function formatCombinedTokens(input: number | null, output: number | null): string {
  if (input === null && output === null) return "Unknown";
  const value = formatTokens((input ?? 0) + (output ?? 0));
  return input === null || output === null ? `At least ${value}` : value;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
      <dd className="mt-1 text-[11px] text-muted-foreground">{detail}</dd>
    </div>
  );
}

function UsageTrend({ report }: { report: UsageReportData }) {
  const chart = useMemo(() => {
    const totals = report.daily.map((point) =>
      point.inputTotal === null || point.outputTotal === null
        ? null
        : point.inputTotal + point.outputTotal,
    );
    const max = Math.max(1, ...totals.map((total) => total ?? 0));
    const points = totals.map((total, index) => {
      if (total === null) return null;
      const x = totals.length === 1 ? 50 : (index / (totals.length - 1)) * 100;
      return {
        x,
        y: 46 - (total / max) * 40,
      };
    });
    const segments: string[] = [];
    let current: string[] = [];
    for (const point of points) {
      if (point === null) {
        if (current.length > 1) segments.push(current.join(" "));
        current = [];
      } else {
        current.push(`${point.x},${point.y}`);
      }
    }
    if (current.length > 1) segments.push(current.join(" "));
    return { points, segments, hasUnknown: totals.some((total) => total === null) };
  }, [report.daily]);

  if (report.daily.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No daily activity.</p>;
  }

  return (
    <div>
      <svg
        viewBox="0 0 100 50"
        preserveAspectRatio="none"
        className="h-36 w-full overflow-visible"
        role="img"
        aria-label="Daily input and output token trend"
      >
        <title>Daily token use</title>
        <line x1="0" y1="46" x2="100" y2="46" className="stroke-border" />
        {chart.segments.map((points) => (
          <polyline
            key={points}
            points={points}
            fill="none"
            vectorEffect="non-scaling-stroke"
            className="stroke-primary"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {chart.points.map((point, index) =>
          point === null ? null : (
            <circle
              key={report.daily[index]?.day}
              cx={point.x}
              cy={point.y}
              r="1.5"
              vectorEffect="non-scaling-stroke"
              className="fill-primary"
            />
          ),
        )}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{report.daily[0]?.day}</span>
        <span>{report.daily.at(-1)?.day}</span>
      </div>
      {chart.hasUnknown && (
        <p className="mt-2 text-xs text-muted-foreground">
          Days with incomplete token counts are omitted from the line.
        </p>
      )}
      <table className="sr-only">
        <caption>Daily token use</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Input tokens</th>
            <th>Output tokens</th>
          </tr>
        </thead>
        <tbody>
          {report.daily.map((point) => (
            <tr key={point.day}>
              <td>{point.day}</td>
              <td>{point.inputTotal ?? "Unknown"}</td>
              <td>{point.outputTotal ?? "Unknown"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsageHeatmap({ report }: { report: UsageReportData }) {
  const cells = new Map(report.heatmap.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]));
  const maximum = Math.max(1, ...report.heatmap.map((cell) => cell.tokenTotal ?? 0));
  return (
    <div>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: "2.5rem repeat(24, minmax(0, 1fr))" }}
        role="img"
        aria-label="Token activity by UTC weekday and hour"
      >
        <span />
        {HOURS.map((hourLabel) => {
          const hour = Number(hourLabel);
          return (
            <span key={`hour-${hourLabel}`} className="text-center text-[8px] text-muted-foreground">
              {hour % 6 === 0 ? hour : ""}
            </span>
          );
        })}
        {WEEKDAYS.flatMap((weekday) => {
          const row: ReactNode[] = [
            <span key={weekday.label} className="text-[10px] text-muted-foreground">
              {weekday.label}
            </span>,
          ];
          for (const hourLabel of HOURS) {
            const hour = Number(hourLabel);
            const cell = cells.get(`${weekday.value}:${hour}`);
            const intensity =
              cell === undefined || cell.tokenTotal === null
                ? 0.04
                : 0.12 + (cell.tokenTotal / maximum) * 0.88;
            const tokenLabel =
              cell === undefined
                ? "No recorded activity"
                : cell.tokenTotal === null
                  ? "Token count unavailable"
                  : `${cell.tokenTotal.toLocaleString()} tokens`;
            row.push(
              <span
                key={`${weekday.label}:${hourLabel}`}
                className="aspect-square rounded-[2px] bg-primary"
                style={{ opacity: intensity }}
                title={`${weekday.label} ${hour}:00 UTC: ${tokenLabel}`}
              />,
            );
          }
          return row;
        })}
      </div>
      <ul className="sr-only">
        {report.heatmap.map((cell) => (
          <li key={`${cell.weekday}:${cell.hour}`}>
            {WEEKDAYS.find((weekday) => weekday.value === cell.weekday)?.label} {cell.hour}:00 UTC:{" "}
            {cell.tokenTotal === null ? "Token count unavailable" : `${cell.tokenTotal} tokens`}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: UsageBreakdown[] }) {
  return (
    <section className="min-w-0 rounded-lg border bg-card">
      <h3 className="border-b px-3 py-2 text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">No recorded usage.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 text-right font-medium">Tokens</th>
                <th className="px-3 py-2 text-right font-medium">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t">
                  <td className="max-w-48 truncate px-3 py-2" title={row.key}>
                    {row.key}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCombinedTokens(row.inputTotal, row.outputTotal)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.sessionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function UsageReport({ report, onExport = downloadUsageReportCsv }: UsageReportProps) {
  const totals = report.totals;
  const cost = totals.costKnownRecords > 0 ? formatCost(totals.estimatedCostUsd) : "Unknown";
  const cacheRate = totals.cacheRate === null ? "Unknown" : `${(totals.cacheRate * 100).toFixed(1)}%`;
  const pageCount = Math.max(1, Math.ceil(report.sessions.total / report.sessions.pageSize));

  return (
    <div className="space-y-5" data-testid="usage-report">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {new Date(report.startMs).toLocaleDateString()} to{" "}
            {new Date(report.endMs - 1).toLocaleDateString()}, shown in UTC
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Estimated cost comes from saved price data, not your provider bill or account quota.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => onExport(report)}>
          <Download aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          label="Input tokens"
          value={totals.inputKnownRecords > 0 ? totals.inputTotal.toLocaleString() : "Unknown"}
          detail={`${totals.inputUnknownRecords} records have no input count`}
        />
        <Metric
          label="Output tokens"
          value={totals.outputKnownRecords > 0 ? totals.outputTotal.toLocaleString() : "Unknown"}
          detail={`${totals.outputUnknownRecords} records have no output count`}
        />
        <Metric
          label="Cache rate"
          value={cacheRate}
          detail={
            totals.cacheUnknownRecords > 0
              ? `${totals.cacheUnknownRecords} records don't have comparable cache data`
              : "Based on records with compatible counters"
          }
        />
        <Metric
          label="Recorded cost estimate"
          value={cost}
          detail={`${totals.costUnknownRecords} records have no cost estimate`}
        />
        <Metric
          label="Sessions"
          value={totals.sessionCount.toLocaleString()}
          detail={`${totals.recordCount} usage records`}
        />
      </dl>

      {(totals.excludedChildRecords > 0 || totals.unavailableRecords > 0) && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {totals.excludedChildRecords > 0 && (
            <p>
              {totals.excludedChildRecords} child records are already included in their parent
              totals, so they are not counted twice.
            </p>
          )}
          {totals.unavailableRecords > 0 && (
            <p>{totals.unavailableRecords} records do not include measured token counts.</p>
          )}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Daily tokens</h3>
          <UsageTrend report={report} />
        </section>
        <section className="overflow-x-auto rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Activity by hour</h3>
          <UsageHeatmap report={report} />
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <BreakdownTable title="Projects" rows={report.byProject} />
        <BreakdownTable title="Agents" rows={report.byRuntime} />
        <BreakdownTable title="Providers" rows={report.byProvider} />
        <BreakdownTable title="Models" rows={report.byModel} />
      </div>

      <section className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h3 className="text-sm font-medium">Sessions</h3>
          <span className="text-xs text-muted-foreground">
            Page {report.sessions.page + 1} of {pageCount}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Session</th>
                <th className="px-3 py-2 font-medium">Project</th>
                <th className="px-3 py-2 font-medium">Agent</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 text-right font-medium">Input</th>
                <th className="px-3 py-2 text-right font-medium">Output</th>
                <th className="px-3 py-2 text-right font-medium">Cost estimate</th>
                <th className="px-3 py-2 font-medium">Billing</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {report.sessions.items.map((session) => (
                <tr
                  key={`${session.sessionId}:${session.runtimeId}:${session.providerId}:${session.modelId}`}
                  className="border-t"
                >
                  <td className="max-w-48 truncate px-3 py-2" title={session.sessionId}>
                    {session.sessionId}
                  </td>
                  <td className="max-w-40 truncate px-3 py-2" title={session.projectId}>
                    {session.projectId}
                  </td>
                  <td className="px-3 py-2">{session.runtimeId}</td>
                  <td className="max-w-40 truncate px-3 py-2" title={session.modelId ?? undefined}>
                    {session.modelId ?? "Unknown"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {session.inputTotal?.toLocaleString() ?? "Unknown"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {session.outputTotal?.toLocaleString() ?? "Unknown"}
                  </td>
                  <td
                    className="px-3 py-2 text-right tabular-nums"
                    title={session.priceVersion ?? "No price source recorded"}
                  >
                    {session.estimatedCostUsd === null
                      ? "Unknown"
                      : formatCost(session.estimatedCostUsd)}
                  </td>
                  <td className="px-3 py-2">{session.billingMode.replaceAll("_", " ")}</td>
                  <td className="px-3 py-2">{session.status.replaceAll("_", " ")}</td>
                  <td className="px-3 py-2">{session.measurement.replaceAll("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.sessions.items.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No sessions match these filters.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function FilterField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-8 text-xs"
      />
    </label>
  );
}

export function UsageReportDialog({
  trigger,
  initialFilter,
  query = queryUsageReport,
}: UsageReportDialogProps) {
  const initial = useMemo(() => createUsageReportFilter(initialFilter), [initialFilter]);
  const [open, setOpen] = useState(false);
  const startDateId = useId();
  const endDateId = useId();
  const [filter, setFilter] = useState(initial);
  const [draft, setDraft] = useState(() => draftFromFilter(initial));
  const reportQuery = useQuery({
    queryKey: ["usage-report", filter],
    queryFn: () => query(filter),
    enabled: open,
    staleTime: 15_000,
  });

  const setDraftValue = (key: keyof DraftFilter, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="flex h-[min(90vh,900px)] max-w-7xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
          <DialogTitle>Usage report</DialogTitle>
          <DialogDescription>
            See recorded token activity by project, agent, model, or session.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid shrink-0 gap-2 border-b bg-muted/20 px-6 py-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8"
          onSubmit={(event) => {
            event.preventDefault();
            setFilter((current) => filterFromDraft(draft, current));
          }}
        >
          <label htmlFor={startDateId} className="space-y-1 text-xs text-muted-foreground">
            <span>From</span>
            <Input
              id={startDateId}
              type="date"
              value={draft.start}
              onChange={(event) => setDraftValue("start", event.target.value)}
              className="h-8 text-xs"
            />
          </label>
          <label htmlFor={endDateId} className="space-y-1 text-xs text-muted-foreground">
            <span>Through</span>
            <Input
              id={endDateId}
              type="date"
              value={draft.end}
              onChange={(event) => setDraftValue("end", event.target.value)}
              className="h-8 text-xs"
            />
          </label>
          <FilterField
            label="Project"
            value={draft.project}
            onChange={(value) => setDraftValue("project", value)}
            placeholder="All projects"
          />
          <FilterField
            label="Agent"
            value={draft.runtime}
            onChange={(value) => setDraftValue("runtime", value)}
            placeholder="All agents"
          />
          <FilterField
            label="Provider"
            value={draft.provider}
            onChange={(value) => setDraftValue("provider", value)}
            placeholder="All providers"
          />
          <FilterField
            label="Model"
            value={draft.model}
            onChange={(value) => setDraftValue("model", value)}
            placeholder="All models"
          />
          <FilterField
            label="Session"
            value={draft.session}
            onChange={(value) => setDraftValue("session", value)}
            placeholder="All sessions"
          />
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm" className="h-8 flex-1">
              <CalendarDays aria-hidden="true" />
              Apply
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-2"
              aria-label="Refresh usage report"
              onClick={() => void reportQuery.refetch()}
            >
              <RefreshCw aria-hidden="true" />
            </Button>
          </div>
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {reportQuery.isPending && (
            <div role="status" className="grid min-h-56 place-items-center text-sm text-muted-foreground">
              Loading usage…
            </div>
          )}
          {reportQuery.isError && (
            <div role="alert" className="grid min-h-56 place-items-center text-center">
              <div>
                <p className="font-medium">The usage report could not be loaded.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {reportQuery.error instanceof Error
                    ? reportQuery.error.message
                    : "Try again in a moment."}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => void reportQuery.refetch()}
                >
                  Try again
                </Button>
              </div>
            </div>
          )}
          {reportQuery.data && reportQuery.data.totals.recordCount === 0 && (
            <div className="grid min-h-56 place-items-center text-center">
              <div>
                <p className="font-medium">No usage was recorded for these filters.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Change the date range or remove a filter.
                </p>
              </div>
            </div>
          )}
          {reportQuery.data && reportQuery.data.totals.recordCount > 0 && (
            <UsageReport report={reportQuery.data} />
          )}
        </div>

        {reportQuery.data && reportQuery.data.sessions.total > reportQuery.data.sessions.pageSize && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t px-6 py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={filter.page === 0}
              onClick={() => setFilter((current) => ({ ...current, page: current.page - 1 }))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={(filter.page + 1) * filter.pageSize >= reportQuery.data.sessions.total}
              onClick={() => setFilter((current) => ({ ...current, page: current.page + 1 }))}
            >
              Next
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
