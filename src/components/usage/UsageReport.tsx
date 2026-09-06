import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download, RefreshCw } from "lucide-react";
import { ProviderLogo } from "@/components/ai/ProviderLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { getProvider } from "@/lib/ai-providers";
import { notifyError, toast } from "@/lib/toast";
import {
  activeQuickRange,
  createUsageReportFilter,
  DAY_MS,
  fillDailySeries,
  isoDay,
  msFromIsoDay,
  queryUsageReport,
  saveUsageReportCsv,
  USAGE_QUICK_RANGES,
  usageQuickRange,
  type UsageBreakdown,
  type UsageQuickRange,
  type UsageReport as UsageReportData,
  type UsageReportFilter,
  type UsageSessionDetail,
} from "@/lib/usage-report";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";

type ReportQuery = (filter: UsageReportFilter) => Promise<UsageReportData>;

type UsageReportDialogProps = {
  trigger: ReactNode;
  initialFilter?: Partial<UsageReportFilter>;
  query?: ReportQuery;
};

type UsageFilterDimension = "project" | "runtime" | "provider" | "model" | "session";

type UsageReportProps = {
  report: UsageReportData;
  onExport?: (report: UsageReportData) => unknown;
  projectNames?: ReadonlyMap<string, string>;
  onSelectFilter?: (dimension: UsageFilterDimension, value: string) => void;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
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

type FilterOption = {
  value: string;
  label: string;
};

const ALL = "__all__";
const EMPTY_PROJECT_NAMES = new Map<string, string>();
const PAGE_SIZES = [10, 25, 50, 100];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const TICK_STEPS = [1, 2, 3, 7, 14, 30, 60, 90];
const ACP_AGENT_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};
const DIMENSION_KEYS = {
  project: { draft: "project", filter: "projectIds" },
  runtime: { draft: "runtime", filter: "runtimeIds" },
  provider: { draft: "provider", filter: "providerIds" },
  model: { draft: "model", filter: "modelIds" },
  session: { draft: "session", filter: "sessionIds" },
} as const;

function draftFromFilter(filter: UsageReportFilter): DraftFilter {
  return {
    start: isoDay(filter.startMs),
    end: isoDay(Math.max(filter.startMs, filter.endMs - 1)),
    project: filter.projectIds[0] ?? "",
    runtime: filter.runtimeIds[0] ?? "",
    provider: filter.providerIds[0] ?? "",
    model: filter.modelIds[0] ?? "",
    session: filter.sessionIds[0] ?? "",
  };
}

function filterFromDraft(draft: DraftFilter, previous: UsageReportFilter): UsageReportFilter {
  const startMs = msFromIsoDay(draft.start);
  const endMs = msFromIsoDay(draft.end);
  const list = (value: string) => (value ? [value] : []);
  return {
    ...previous,
    startMs: startMs ?? previous.startMs,
    endMs: endMs === null ? previous.endMs : endMs + DAY_MS,
    projectIds: list(draft.project),
    runtimeIds: list(draft.runtime),
    providerIds: list(draft.provider),
    modelIds: list(draft.model),
    sessionIds: list(draft.session),
    page: 0,
  };
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatExact(value: number): string {
  return value.toLocaleString();
}

function formatCost(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function formatUtcDay(value: number | string, withYear = false): string {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  return date.toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function formatUtcTime(value: number): string {
  return new Date(value).toLocaleString(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRange(startMs: number, endMs: number): string {
  const last = Math.max(startMs, endMs - 1);
  return `${formatUtcDay(startMs)} to ${formatUtcDay(last, true)} (UTC)`;
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

function shortIdentifier(value: string): string {
  return value.length > 28 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

function projectLabel(value: string, projectNames: ReadonlyMap<string, string>): string {
  if (value === "global") return "General";
  if (value === "Mixed") return "Mixed";
  return projectNames.get(value) ?? shortIdentifier(value);
}

function runtimeLabel(value: string): string {
  if (value === "built-in") return "Oleafly assistant";
  if (value === "built-in:helper") return "Helper calls";
  if (value === "acp") return "CLI agents";
  if (value.startsWith("acp:")) {
    const agent = value.slice("acp:".length);
    return ACP_AGENT_NAMES[agent] ?? shortIdentifier(agent);
  }
  return shortIdentifier(value);
}

function providerLabel(value: string): string {
  return getProvider(value)?.name ?? ACP_AGENT_NAMES[value] ?? shortIdentifier(value);
}

function billingLabel(value: string): string {
  const labels: Record<string, string> = {
    api: "API",
    subscription: "Plan",
    local: "Local",
    unknown: "Unknown",
    mixed: "Mixed",
  };
  return labels[value] ?? value;
}

function scopeLabel(value: string): string | null {
  const labels: Record<string, string> = {
    child: "Subagent",
    task: "Task",
    helper: "Helper",
  };
  return labels[value] ?? null;
}

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    in_progress: "In progress",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    interrupted: "Interrupted",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function measurementLabel(value: string): string {
  const labels: Record<string, string> = {
    provider_reported: "Counted by the provider",
    runtime_reported: "Counted by the agent",
    estimated: "Estimated locally",
    unavailable: "Not measured",
    mixed_or_unavailable: "Partly measured",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function statusClass(value: string): string {
  if (value === "failed") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (value === "cancelled" || value === "interrupted") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  }
  if (value === "in_progress") return "border-primary/20 bg-primary/10 text-primary";
  return "border-border bg-muted text-muted-foreground";
}

function filterOptions(
  values: Iterable<string | null>,
  label: (value: string) => string,
  selected: string,
): FilterOption[] {
  const unique = new Set(
    [...values].filter(
      (value): value is string => Boolean(value) && value !== "Unknown" && value !== "Mixed",
    ),
  );
  if (selected) unique.add(selected);
  return [...unique]
    .map((value) => ({ value, label: label(value) }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function tokenCell(value: number | null): string {
  return value === null ? "Unknown" : formatExact(value);
}

function combinedTokens(input: number | null, output: number | null): string {
  if (input === null && output === null) return "Unknown";
  return formatTokens((input ?? 0) + (output ?? 0));
}

function costCell(
  cost: number | null,
  counts: { unpricedRecords: number; planRecords: number; recordCount: number },
  billingMode?: string,
): { text: string; note: string | null } {
  if (cost !== null) {
    const note =
      counts.unpricedRecords > 0
        ? `${counts.unpricedRecords} of ${plural(counts.recordCount, "record")} unpriced`
        : null;
    return { text: formatCost(cost), note };
  }
  if (counts.recordCount > 0 && counts.planRecords === counts.recordCount) {
    return { text: billingMode === "local" ? "Local" : "Plan", note: "Not billed per token" };
  }
  return { text: "No estimate", note: "No saved price for these records" };
}

function Truncated({ value, label, className }: { value: string; label?: string; className?: string }) {
  const text = label ?? value;
  return (
    <Tooltip label={value} wide>
      <span className={cn("block max-w-[11rem] truncate", className)}>{text}</span>
    </Tooltip>
  );
}

function Metric({
  label,
  value,
  detail,
  exact,
}: {
  label: string;
  value: string;
  detail: ReactNode;
  exact?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums" title={exact}>
        {value}
      </dd>
      <dd className="mt-1 text-[11px] text-muted-foreground">{detail}</dd>
    </div>
  );
}

function tickStep(length: number): number {
  return TICK_STEPS.find((step) => Math.ceil(length / step) <= 7) ?? TICK_STEPS.at(-1) ?? 90;
}

function UsageTrend({ report }: { report: UsageReportData }) {
  const series = useMemo(() => fillDailySeries(report), [report]);
  const [hover, setHover] = useState<number | null>(null);
  const chart = useMemo(() => {
    const totals = series.map((point) =>
      point.inputTotal === null || point.outputTotal === null
        ? null
        : point.inputTotal + point.outputTotal,
    );
    const max = Math.max(1, ...totals.map((total) => total ?? 0));
    const count = series.length;
    const x = (index: number) => (count === 1 ? 50 : (index / (count - 1)) * 100);
    const y = (total: number) => 37 - (total / max) * 33;
    const points = totals.map((total, index) =>
      total === null ? null : { x: x(index), y: y(total) },
    );
    const segments: Array<{ line: string; area: string }> = [];
    let current: Array<{ x: number; y: number }> = [];
    const flush = () => {
      if (current.length > 0) {
        const line = current.map((point) => `${point.x},${point.y}`).join(" ");
        const first = current[0];
        const last = current[current.length - 1];
        segments.push({
          line,
          area: `M${first.x},37 L${current.map((point) => `${point.x},${point.y}`).join(" L")} L${last.x},37 Z`,
        });
      }
      current = [];
    };
    for (const point of points) {
      if (point === null) flush();
      else current.push(point);
    }
    flush();
    const step = tickStep(count);
    const ticks: Array<{ index: number; x: number }> = [];
    for (let index = 0; index < count; index += step) ticks.push({ index, x: x(index) });
    return {
      totals,
      points,
      segments,
      ticks,
      x,
      hasUnknown: totals.some((total) => total === null),
    };
  }, [series]);

  if (series.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No daily activity.</p>;
  }

  const hovered = hover === null ? null : series[hover];
  const hoveredPoint = hover === null ? null : chart.points[hover];

  return (
    <div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover only reveals a reading; the table below carries the data */}
      <div
        className="relative"
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width <= 0) return;
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          setHover(Math.round(ratio * (series.length - 1)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <svg
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
          className="h-40 w-full overflow-visible"
          role="img"
          aria-label="Daily input and output token trend"
        >
          <title>Daily token use</title>
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1="0"
              y1={37 - fraction * 33}
              x2="100"
              y2={37 - fraction * 33}
              className="stroke-border/60"
              strokeDasharray="1 1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line x1="0" y1="37" x2="100" y2="37" className="stroke-border" vectorEffect="non-scaling-stroke" />
          {chart.segments.map((segment) => (
            <path key={segment.area} d={segment.area} className="fill-primary/15" />
          ))}
          {chart.segments.map((segment) => (
            <polyline
              key={segment.line}
              points={segment.line}
              fill="none"
              vectorEffect="non-scaling-stroke"
              className="stroke-primary"
              strokeWidth="1.75"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {chart.points.map((point, index) =>
            point === null || series[index].recordCount === 0 ? null : (
              <circle
                key={series[index].day}
                cx={point.x}
                cy={point.y}
                r="1.6"
                vectorEffect="non-scaling-stroke"
                className="fill-primary stroke-card"
                strokeWidth="1"
              />
            ),
          )}
          {hover !== null && (
            <line
              x1={chart.x(hover)}
              y1="2"
              x2={chart.x(hover)}
              y2="37"
              className="stroke-foreground/40"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {hovered && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md motion-safe:transition-opacity"
            style={{
              left: `${chart.x(hover ?? 0)}%`,
              transform: `translateX(${(hover ?? 0) > series.length / 2 ? "calc(-100% - 8px)" : "8px"})`,
            }}
          >
            <p className="font-medium">{formatUtcDay(hovered.day, true)}</p>
            {hoveredPoint === null ? (
              <p className="text-muted-foreground">Token counts unavailable</p>
            ) : (
              <p className="tabular-nums text-muted-foreground">
                {formatExact(hovered.inputTotal ?? 0)} in, {formatExact(hovered.outputTotal ?? 0)}{" "}
                out
              </p>
            )}
            <p className="text-muted-foreground">{plural(hovered.recordCount, "record")}</p>
          </div>
        )}
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-muted-foreground">
        {chart.ticks.map((tick, position) => (
          <span
            key={tick.index}
            className="absolute top-0 whitespace-nowrap"
            style={{
              left: `${tick.x}%`,
              transform:
                position === 0
                  ? "none"
                  : tick.x > 92
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
            }}
          >
            {formatUtcDay(series[tick.index].day)}
          </span>
        ))}
      </div>
      {chart.hasUnknown && (
        <p className="mt-2 text-xs text-muted-foreground">
          Days with incomplete token counts are left out of the line.
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
          {series.map((point) => (
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
        style={{ gridTemplateColumns: "2.25rem repeat(24, minmax(0, 1fr))" }}
        role="img"
        aria-label="Token activity by UTC weekday and hour"
      >
        <span />
        {HOURS.map((hour) => (
          <span key={`hour-${hour}`} className="text-center text-[9px] text-muted-foreground">
            {hour % 6 === 0 ? hour : ""}
          </span>
        ))}
        {WEEKDAYS.flatMap((weekday, weekdayIndex) => {
          const row: ReactNode[] = [
            <span key={weekday} className="text-[10px] leading-4 text-muted-foreground">
              {weekday}
            </span>,
          ];
          for (const hour of HOURS) {
            const cell = cells.get(`${weekdayIndex}:${hour}`);
            const intensity =
              cell === undefined || cell.tokenTotal === null
                ? 0
                : 0.15 + (cell.tokenTotal / maximum) * 0.85;
            const tokenLabel =
              cell === undefined
                ? "No recorded activity"
                : cell.tokenTotal === null
                  ? "Token count unavailable"
                  : `${cell.tokenTotal.toLocaleString()} tokens`;
            row.push(
              <span
                key={`${weekday}:${hour}`}
                className={cn(
                  "aspect-square rounded-[2px]",
                  cell === undefined ? "bg-muted" : cell.tokenTotal === null ? "bg-muted-foreground/30" : "bg-primary",
                )}
                style={intensity > 0 ? { opacity: intensity } : undefined}
                title={`${weekday} ${hour}:00 UTC: ${tokenLabel}`}
              />,
            );
          }
          return row;
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Hours in UTC</span>
        <span className="flex items-center gap-1">
          Less
          {[0.15, 0.36, 0.57, 0.78, 1].map((opacity) => (
            <span
              key={opacity}
              className="inline-block size-2.5 rounded-[2px] bg-primary"
              style={{ opacity }}
            />
          ))}
          More
        </span>
      </div>
      <ul className="sr-only">
        {report.heatmap.map((cell) => (
          <li key={`${cell.weekday}:${cell.hour}`}>
            {WEEKDAYS[cell.weekday]} {cell.hour}:00 UTC:{" "}
            {cell.tokenTotal === null ? "Token count unavailable" : `${cell.tokenTotal} tokens`}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
  labelForKey = (value) => value,
  onSelect,
  icon,
}: {
  title: string;
  rows: UsageBreakdown[];
  labelForKey?: (value: string) => string;
  onSelect?: (value: string) => void;
  icon?: (value: string) => ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
      <h3 className="border-b px-3 py-2 text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">No recorded usage.</p>
      ) : (
        <Table containerClassName="max-h-64">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead numeric>Tokens</TableHead>
              <TableHead numeric>Cost</TableHead>
              <TableHead numeric>Sessions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const cost = costCell(row.estimatedCostUsd, row);
              const label = labelForKey(row.key);
              const selectable = onSelect && row.key !== "Unknown";
              return (
                <TableRow key={row.key} data-key={row.key}>
                  <TableCell className="max-w-0">
                    <span className="flex items-center gap-2">
                      {icon?.(row.key)}
                      {selectable ? (
                        <Tooltip label={row.key} wide>
                          <button
                            type="button"
                            className="block max-w-[11rem] truncate text-left font-medium text-foreground underline-offset-4 hover:underline"
                            onClick={() => onSelect(row.key)}
                          >
                            {label}
                          </button>
                        </Tooltip>
                      ) : (
                        <Truncated value={row.key} label={label} />
                      )}
                    </span>
                  </TableCell>
                  <TableCell numeric title={`${tokenCell(row.inputTotal)} in, ${tokenCell(row.outputTotal)} out`}>
                    {combinedTokens(row.inputTotal, row.outputTotal)}
                  </TableCell>
                  <TableCell numeric title={cost.note ?? undefined}>
                    {cost.text}
                    {cost.note && row.estimatedCostUsd !== null && (
                      <span className="text-muted-foreground">*</span>
                    )}
                  </TableCell>
                  <TableCell numeric>{formatExact(row.sessionCount)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function SessionsTable({
  report,
  projectNames,
  onSelectFilter,
  onPageChange,
  onPageSizeChange,
}: {
  report: UsageReportData;
  projectNames: ReadonlyMap<string, string>;
  onSelectFilter?: UsageReportProps["onSelectFilter"];
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}) {
  const { items, page, pageSize, total } = report.sessions;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const renderSession = (session: UsageSessionDetail) => {
    const cost = costCell(session.estimatedCostUsd, session, session.billingMode);
    const scope = scopeLabel(session.scope);
    return (
      <TableRow key={session.sessionId} data-session-id={session.sessionId}>
        <TableCell className="max-w-0">
          <span className="flex items-center gap-2">
            {onSelectFilter ? (
              <Tooltip label={session.sessionId} wide>
                <button
                  type="button"
                  className="block max-w-[10rem] truncate text-left font-medium text-foreground underline-offset-4 hover:underline"
                  onClick={() => onSelectFilter("session", session.sessionId)}
                >
                  {shortIdentifier(session.sessionId)}
                </button>
              </Tooltip>
            ) : (
              <Truncated value={session.sessionId} label={shortIdentifier(session.sessionId)} className="max-w-[10rem] font-medium" />
            )}
            {scope && (
              <Badge variant="quiet" className="text-[10px]">
                {scope}
              </Badge>
            )}
          </span>
        </TableCell>
        <TableCell className="max-w-0" data-project-id={session.projectId}>
          <Truncated value={session.projectId} label={projectLabel(session.projectId, projectNames)} />
        </TableCell>
        <TableCell className="whitespace-nowrap" data-runtime-id={session.runtimeId}>
          {runtimeLabel(session.runtimeId)}
        </TableCell>
        <TableCell className="max-w-0">
          <span className="flex items-center gap-2">
            {session.providerId && session.providerId !== "Mixed" && (
              <ProviderLogo providerId={session.providerId} size={14} />
            )}
            <Truncated value={session.modelId ?? "Unknown"} className="max-w-[10rem]" />
          </span>
        </TableCell>
        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
          {formatUtcTime(session.occurredAtMs)}
        </TableCell>
        <TableCell numeric>{tokenCell(session.inputTotal)}</TableCell>
        <TableCell numeric>{tokenCell(session.outputTotal)}</TableCell>
        <TableCell numeric>
          <Tooltip
            label={[
              cost.note,
              session.priceVersion ? `Price source: ${session.priceVersion}` : null,
              measurementLabel(session.measurement),
            ]
              .filter(Boolean)
              .join(". ")}
            wide
          >
            <span className="tabular-nums">
              {cost.text}
              {cost.note && session.estimatedCostUsd !== null && (
                <span className="text-muted-foreground">*</span>
              )}
            </span>
          </Tooltip>
        </TableCell>
        <TableCell>
          <Badge variant="quiet" className="text-[10px]">
            {billingLabel(session.billingMode)}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={cn("text-[10px]", statusClass(session.status))}>
            {statusLabel(session.status)}
          </Badge>
        </TableCell>
      </TableRow>
    );
  };

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div>
          <h3 className="text-sm font-medium">Sessions</h3>
          <p className="text-[11px] text-muted-foreground">
            Chats, tasks, subagent runs and helper calls, most recent first.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">{plural(total, "session")}</span>
      </div>
      {items.length === 0 ? (
        <Empty className="px-6 py-10">
          <EmptyHeader>
            <EmptyTitle className="text-base">No sessions match these filters</EmptyTitle>
            <EmptyDescription>Change the date range or remove a filter.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table containerClassName="max-h-[28rem]" className="min-w-[960px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Session</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Last activity (UTC)</TableHead>
              <TableHead numeric>Input</TableHead>
              <TableHead numeric>Output</TableHead>
              <TableHead numeric>Cost</TableHead>
              <TableHead>Billing</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{items.map(renderSession)}</TableBody>
        </Table>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Rows per page</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange?.(Number(value))}
          >
            <SelectTrigger className="h-7 w-[4.5rem] text-xs" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)} className="text-xs">
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{`Page ${page + 1} of ${pageCount}`}</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={page === 0}
            onClick={() => onPageChange?.(page - 1)}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={(page + 1) * pageSize >= total}
            onClick={() => onPageChange?.(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}

export function UsageReport({
  report,
  onExport = saveUsageReportCsv,
  projectNames = EMPTY_PROJECT_NAMES,
  onSelectFilter,
  onPageChange,
  onPageSizeChange,
}: UsageReportProps) {
  const totals = report.totals;
  const [exporting, setExporting] = useState(false);
  const cost = costCell(totals.costKnownRecords > 0 ? totals.estimatedCostUsd : null, totals);
  const costDetail = [
    totals.unpricedRecords > 0 ? `${plural(totals.unpricedRecords, "record")} unpriced` : null,
    totals.planRecords > 0 ? `${plural(totals.planRecords, "record")} on a plan or local` : null,
  ].filter(Boolean);
  const cacheDetail =
    totals.cacheRate === null
      ? `${plural(totals.cacheUnknownRecords, "record")} without comparable cache data`
      : `${(totals.cacheRate * 100).toFixed(1)}% of comparable input${
          totals.cacheUnknownRecords > 0 ? `, ${totals.cacheUnknownRecords} not comparable` : ""
        }`;

  const exportReport = async () => {
    setExporting(true);
    try {
      const saved = await onExport(report);
      if (typeof saved === "string") toast.success(`Saved ${saved}`);
    } catch (error) {
      notifyError("usage export", error, "The usage report could not be saved.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="usage-report">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{formatRange(report.startMs, report.endMs)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cost estimates use saved price data, not your provider bill or plan quota.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={exporting}
          onClick={() => void exportReport()}
        >
          <Download aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          label="Input tokens"
          value={totals.inputKnownRecords > 0 ? formatExact(totals.inputTotal) : "Unknown"}
          detail={
            totals.inputUnknownRecords > 0
              ? `${plural(totals.inputUnknownRecords, "record")} without an input count`
              : "Includes cached input"
          }
        />
        <Metric
          label="Output tokens"
          value={totals.outputKnownRecords > 0 ? formatExact(totals.outputTotal) : "Unknown"}
          detail={
            totals.outputUnknownRecords > 0
              ? `${plural(totals.outputUnknownRecords, "record")} without an output count`
              : "Includes reasoning tokens"
          }
        />
        <Metric
          label="Cache reads"
          value={totals.cacheKnownRecords > 0 ? formatExact(totals.cacheReadTotal) : "Unknown"}
          detail={cacheDetail}
        />
        <Metric
          label="Cost estimate"
          value={cost.text}
          detail={costDetail.length > 0 ? costDetail.join(", ") : "All records priced"}
        />
        <Metric
          label="Sessions"
          value={formatExact(totals.sessionCount)}
          detail={`${plural(totals.childRunCount, "child run")}, ${plural(totals.recordCount, "usage record")}`}
        />
      </dl>

      {(totals.excludedChildRecords > 0 || totals.unavailableRecords > 0) && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {totals.excludedChildRecords > 0 && (
            <p>
              {plural(totals.excludedChildRecords, "child record")} already counted in a parent
              total, so not counted twice.
            </p>
          )}
          {totals.unavailableRecords > 0 && (
            <p>{plural(totals.unavailableRecords, "record")} without measured token counts.</p>
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

      <div className="grid gap-4 md:grid-cols-2">
        <BreakdownTable
          title="Projects"
          rows={report.byProject}
          labelForKey={(value) => projectLabel(value, projectNames)}
          onSelect={onSelectFilter ? (value) => onSelectFilter("project", value) : undefined}
        />
        <BreakdownTable
          title="Agents"
          rows={report.byRuntime}
          labelForKey={runtimeLabel}
          onSelect={onSelectFilter ? (value) => onSelectFilter("runtime", value) : undefined}
        />
        <BreakdownTable
          title="Providers"
          rows={report.byProvider}
          labelForKey={providerLabel}
          icon={(value) =>
            value === "Unknown" ? null : <ProviderLogo providerId={value} size={14} />
          }
          onSelect={onSelectFilter ? (value) => onSelectFilter("provider", value) : undefined}
        />
        <BreakdownTable
          title="Models"
          rows={report.byModel}
          labelForKey={shortIdentifier}
          onSelect={onSelectFilter ? (value) => onSelectFilter("model", value) : undefined}
        />
      </div>

      <SessionsTable
        report={report}
        projectNames={projectNames}
        onSelectFilter={onSelectFilter}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  allLabel,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  allLabel: string;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <span className="block text-[11px] text-muted-foreground">{label}</span>
      <Select value={value || ALL} onValueChange={(next) => onChange(next === ALL ? "" : next)}>
        <SelectTrigger className="h-8 text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL} className="text-xs">
            {allLabel}
          </SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} data-value={option.value} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function UsageReportDialog({
  trigger,
  initialFilter,
  query = queryUsageReport,
}: UsageReportDialogProps) {
  const initial = useMemo(() => createUsageReportFilter(initialFilter), [initialFilter]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(initial);
  const [draft, setDraft] = useState(() => draftFromFilter(initial));
  const projects = useFilesStore((state) => state.projects);
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const reportQuery = useQuery({
    queryKey: ["usage-report", filter],
    queryFn: () => query(filter),
    enabled: open,
    staleTime: 15_000,
  });
  const today = isoDay(Date.now());
  const quickRange = activeQuickRange(filter);

  const setDraftValue = (key: keyof DraftFilter, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const choices = useMemo(() => {
    const report = reportQuery.data;
    return {
      project: filterOptions(
        report?.byProject.map((row) => row.key) ?? [],
        (value) => projectLabel(value, projectNames),
        draft.project,
      ),
      runtime: filterOptions(
        report?.byRuntime.map((row) => row.key) ?? [],
        runtimeLabel,
        draft.runtime,
      ),
      provider: filterOptions(
        report?.byProvider.map((row) => row.key) ?? [],
        providerLabel,
        draft.provider,
      ),
      model: filterOptions(
        report?.byModel.map((row) => row.key) ?? [],
        shortIdentifier,
        draft.model,
      ),
      session: filterOptions(
        report?.sessions.items.map((session) => session.sessionId) ?? [],
        shortIdentifier,
        draft.session,
      ),
    };
  }, [draft, projectNames, reportQuery.data]);

  const chooseFilter = (dimension: UsageFilterDimension, value: string) => {
    const key = DIMENSION_KEYS[dimension];
    setDraft((current) => ({ ...current, [key.draft]: value }));
    setFilter((current) => ({ ...current, [key.filter]: [value], page: 0 }));
  };

  const applyQuickRange = (range: UsageQuickRange) => {
    const bounds = usageQuickRange(range);
    setDraft((current) => ({
      ...current,
      start: isoDay(bounds.startMs),
      end: isoDay(bounds.endMs - 1),
    }));
    setFilter((current) => ({ ...current, ...bounds, page: 0 }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="flex h-[min(90vh,900px)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
          <DialogTitle>Usage report</DialogTitle>
          <DialogDescription>
            Recorded token activity by project, agent, provider, model and session.
          </DialogDescription>
        </DialogHeader>

        <form
          className="shrink-0 space-y-3 border-b bg-muted/20 px-6 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            setFilter((current) => filterFromDraft(draft, current));
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">From</span>
                <DatePicker
                  aria-label="From"
                  value={draft.start}
                  max={draft.end || today}
                  buttonClassName="h-8 w-40 text-xs"
                  onChange={(value) => setDraftValue("start", value ?? draft.start)}
                />
              </div>
              <div className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">Through</span>
                <DatePicker
                  aria-label="Through"
                  value={draft.end}
                  min={draft.start}
                  max={today}
                  buttonClassName="h-8 w-40 text-xs"
                  onChange={(value) => setDraftValue("end", value ?? draft.end)}
                />
              </div>
            </div>
            <fieldset className="flex items-center gap-1 pb-1">
              <legend className="sr-only">Quick ranges</legend>
              {USAGE_QUICK_RANGES.map((range) => (
                <Button
                  key={range.id}
                  type="button"
                  size="xs"
                  variant={quickRange === range.id ? "secondary" : "outline"}
                  aria-pressed={quickRange === range.id}
                  onClick={() => applyQuickRange(range.id)}
                >
                  {range.label}
                </Button>
              ))}
            </fieldset>
            <span className="pb-1.5 text-[11px] text-muted-foreground">Dates and hours are in UTC.</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <FilterSelect
              label="Project"
              value={draft.project}
              options={choices.project}
              allLabel="All projects"
              onChange={(value) => setDraftValue("project", value)}
            />
            <FilterSelect
              label="Agent"
              value={draft.runtime}
              options={choices.runtime}
              allLabel="All agents"
              onChange={(value) => setDraftValue("runtime", value)}
            />
            <FilterSelect
              label="Provider"
              value={draft.provider}
              options={choices.provider}
              allLabel="All providers"
              onChange={(value) => setDraftValue("provider", value)}
            />
            <FilterSelect
              label="Model"
              value={draft.model}
              options={choices.model}
              allLabel="All models"
              onChange={(value) => setDraftValue("model", value)}
            />
            <FilterSelect
              label="Session"
              value={draft.session}
              options={choices.session}
              allLabel="All sessions"
              onChange={(value) => setDraftValue("session", value)}
            />
            <div className="flex items-end gap-2">
              <Button type="submit" size="sm" className="h-8 flex-1">
                Apply
              </Button>
              <Tooltip label="Refresh">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 w-8 px-0"
                  aria-label="Refresh usage report"
                  onClick={() => void reportQuery.refetch()}
                >
                  <RefreshCw aria-hidden="true" className={cn(reportQuery.isFetching && "motion-safe:animate-spin")} />
                </Button>
              </Tooltip>
            </div>
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
            <Empty className="min-h-56">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BarChart3 className="size-5" />
                </EmptyMedia>
                <EmptyTitle>No usage was recorded for these filters.</EmptyTitle>
                <EmptyDescription>Change the date range or remove a filter.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {reportQuery.data && reportQuery.data.totals.recordCount > 0 && (
            <UsageReport
              report={reportQuery.data}
              projectNames={projectNames}
              onSelectFilter={chooseFilter}
              onPageChange={(page) => setFilter((current) => ({ ...current, page }))}
              onPageSizeChange={(pageSize) =>
                setFilter((current) => ({ ...current, pageSize, page: 0 }))
              }
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
