import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
import { i18n } from "@/i18n";
import { getProvider } from "@/lib/ai-providers";
import {
  formatCompactNumber,
  formatDate,
  formatDateTime,
  formatList,
  formatNumber,
} from "@/lib/intl";
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
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
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
  return formatCompactNumber(value);
}

function formatExact(value: number): string {
  return formatNumber(value);
}

function formatCost(value: number): string {
  return formatNumber(value, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  });
}

function formatUtcDay(value: number | string, withYear = false): string {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  return formatDate(date, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function formatUtcTime(value: number): string {
  return formatDateTime(new Date(value), {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRange(startMs: number, endMs: number): string {
  const last = Math.max(startMs, endMs - 1);
  return i18n.t(($) => $.usage.report.range, {
    start: formatUtcDay(startMs),
    end: formatUtcDay(last, true),
  });
}

function records(count: number): string {
  return i18n.t(($) => $.usage.counts.records, { count, total: formatNumber(count) });
}

function sessionsCount(count: number): string {
  return i18n.t(($) => $.usage.counts.sessions, { count, total: formatNumber(count) });
}

function joinNotes(items: readonly string[]): string {
  return formatList(items, { style: "narrow" });
}

function shortIdentifier(value: string): string {
  return value.length > 28 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

function projectLabel(value: string, projectNames: ReadonlyMap<string, string>): string {
  if (value === "global") return i18n.t(($) => $.usage.labels.generalProject);
  if (value === "Mixed") return i18n.t(($) => $.usage.labels.mixed);
  return projectNames.get(value) ?? shortIdentifier(value);
}

function runtimeLabel(value: string): string {
  if (value === "built-in") return i18n.t(($) => $.usage.labels.runtimeBuiltIn);
  if (value === "built-in:helper") return i18n.t(($) => $.usage.labels.runtimeHelper);
  if (value === "acp") return i18n.t(($) => $.usage.labels.runtimeAcp);
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
  switch (value) {
    case "api":
      return i18n.t(($) => $.usage.billing.api);
    case "subscription":
      return i18n.t(($) => $.usage.billing.subscription);
    case "local":
      return i18n.t(($) => $.usage.billing.local);
    case "unknown":
      return i18n.t(($) => $.usage.billing.unknown);
    case "mixed":
      return i18n.t(($) => $.usage.billing.mixed);
    default:
      return value;
  }
}

function scopeLabel(value: string): string | null {
  switch (value) {
    case "child":
      return i18n.t(($) => $.usage.scope.child);
    case "task":
      return i18n.t(($) => $.usage.scope.task);
    case "helper":
      return i18n.t(($) => $.usage.scope.helper);
    default:
      return null;
  }
}

function statusLabel(value: string): string {
  switch (value) {
    case "in_progress":
      return i18n.t(($) => $.usage.status.in_progress);
    case "completed":
      return i18n.t(($) => $.usage.status.completed);
    case "failed":
      return i18n.t(($) => $.usage.status.failed);
    case "cancelled":
      return i18n.t(($) => $.usage.status.cancelled);
    case "interrupted":
      return i18n.t(($) => $.usage.status.interrupted);
    default:
      return value.replaceAll("_", " ");
  }
}

function measurementLabel(value: string): string {
  switch (value) {
    case "provider_reported":
      return i18n.t(($) => $.usage.measurement.provider_reported);
    case "runtime_reported":
      return i18n.t(($) => $.usage.measurement.runtime_reported);
    case "estimated":
      return i18n.t(($) => $.usage.measurement.estimated);
    case "unavailable":
      return i18n.t(($) => $.usage.measurement.unavailable);
    case "mixed_or_unavailable":
      return i18n.t(($) => $.usage.measurement.mixed_or_unavailable);
    default:
      return value.replaceAll("_", " ");
  }
}

function statusClass(value: string): string {
  if (value === "failed") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (value === "completed") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  }
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
  return value === null ? i18n.t(($) => $.usage.labels.unknown) : formatExact(value);
}

function combinedTokens(input: number | null, output: number | null): string {
  if (input === null && output === null) return i18n.t(($) => $.usage.labels.unknown);
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
        ? i18n.t(($) => $.usage.counts.partlyUnpriced, {
            count: counts.recordCount,
            unpriced: formatNumber(counts.unpricedRecords),
            total: formatNumber(counts.recordCount),
          })
        : null;
    return { text: formatCost(cost), note };
  }
  if (counts.recordCount > 0 && counts.planRecords === counts.recordCount) {
    return {
      text:
        billingMode === "local"
          ? i18n.t(($) => $.usage.cost.local)
          : i18n.t(($) => $.usage.cost.plan),
      note: i18n.t(($) => $.usage.cost.notBilledPerToken),
    };
  }
  return {
    text: i18n.t(($) => $.usage.cost.noEstimate),
    note: i18n.t(($) => $.usage.cost.noSavedPrice),
  };
}

function Truncated({ value, label, className }: Readonly<{ value: string; label?: string; className?: string }>) {
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
}: Readonly<{
  label: string;
  value: string;
  detail: ReactNode;
  exact?: string;
}>) {
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

function tickTransform(position: number, x: number): string {
  if (position === 0) return "none";
  if (x > 92) return "translateX(-100%)";
  return "translateX(-50%)";
}

function heatmapCellTone(cell: UsageReportData["heatmap"][number] | undefined): string {
  if (cell === undefined) return "bg-muted";
  if (cell.tokenTotal === null) return "bg-muted-foreground/30";
  return "bg-primary";
}

function UsageTrend({ report }: Readonly<{ report: UsageReportData }>) {
  const { t } = useTranslation(["usage"]);
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
        const points = current.map((point) => `${point.x},${point.y}`);
        const line = points.join(" ");
        const first = current[0];
        const last = current.at(-1) ?? first;
        segments.push({
          line,
          area: `M${first.x},37 L${points.join(" L")} L${last.x},37 Z`,
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
      hasUnknown: totals.includes(null),
    };
  }, [series]);

  if (series.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t(($) => $.usage.trend.empty)}
      </p>
    );
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
          aria-label={t(($) => $.usage.trend.chartLabel)}
        >
          <title>{t(($) => $.usage.trend.chartTitle)}</title>
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
              <p className="text-muted-foreground">{t(($) => $.usage.trend.tokensUnavailable)}</p>
            ) : (
              <p className="tabular-nums text-muted-foreground">
                {t(($) => $.usage.trend.inOut, {
                  input: formatExact(hovered.inputTotal ?? 0),
                  output: formatExact(hovered.outputTotal ?? 0),
                })}
              </p>
            )}
            <p className="text-muted-foreground">{records(hovered.recordCount)}</p>
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
              transform: tickTransform(position, tick.x),
            }}
          >
            {formatUtcDay(series[tick.index].day)}
          </span>
        ))}
      </div>
      {chart.hasUnknown && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t(($) => $.usage.trend.incompleteDays)}
        </p>
      )}
      <table className="sr-only">
        <caption>{t(($) => $.usage.trend.chartTitle)}</caption>
        <thead>
          <tr>
            <th>{t(($) => $.usage.trend.day)}</th>
            <th>{t(($) => $.usage.trend.inputTokens)}</th>
            <th>{t(($) => $.usage.trend.outputTokens)}</th>
          </tr>
        </thead>
        <tbody>
          {series.map((point) => (
            <tr key={point.day}>
              <td>{point.day}</td>
              <td>{point.inputTotal ?? t(($) => $.usage.labels.unknown)}</td>
              <td>{point.outputTotal ?? t(($) => $.usage.labels.unknown)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsageHeatmap({ report }: Readonly<{ report: UsageReportData }>) {
  const { t } = useTranslation(["usage"]);
  const weekdays: Record<(typeof WEEKDAY_KEYS)[number], string> = {
    sun: t(($) => $.usage.heatmap.weekdays.sun),
    mon: t(($) => $.usage.heatmap.weekdays.mon),
    tue: t(($) => $.usage.heatmap.weekdays.tue),
    wed: t(($) => $.usage.heatmap.weekdays.wed),
    thu: t(($) => $.usage.heatmap.weekdays.thu),
    fri: t(($) => $.usage.heatmap.weekdays.fri),
    sat: t(($) => $.usage.heatmap.weekdays.sat),
  };
  const cells = new Map(report.heatmap.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]));
  const maximum = Math.max(1, ...report.heatmap.map((cell) => cell.tokenTotal ?? 0));
  return (
    <div>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: "2.25rem repeat(24, minmax(0, 1fr))" }}
        role="img"
        aria-label={t(($) => $.usage.heatmap.label)}
      >
        <span />
        {HOURS.map((hour) => (
          <span key={`hour-${hour}`} className="text-center text-[9px] text-muted-foreground">
            {hour % 6 === 0 ? hour : ""}
          </span>
        ))}
        {WEEKDAY_KEYS.flatMap((weekdayKey, weekdayIndex) => {
          const weekday = weekdays[weekdayKey];
          const row: ReactNode[] = [
            <span key={weekdayKey} className="text-[10px] leading-4 text-muted-foreground">
              {weekday}
            </span>,
          ];
          for (const hour of HOURS) {
            const cell = cells.get(`${weekdayIndex}:${hour}`);
            const intensity =
              cell === undefined || cell.tokenTotal === null
                ? 0
                : 0.15 + (cell.tokenTotal / maximum) * 0.85;
            let tokenLabel: string;
            if (cell === undefined) {
              tokenLabel = t(($) => $.usage.heatmap.noActivity);
            } else if (cell.tokenTotal === null) {
              tokenLabel = t(($) => $.usage.heatmap.tokenUnavailable);
            } else {
              tokenLabel = t(($) => $.usage.counts.tokens, {
                count: cell.tokenTotal,
                total: formatNumber(cell.tokenTotal),
              });
            }
            row.push(
              <span
                key={`${weekdayKey}:${hour}`}
                className={cn(
                  "aspect-square rounded-[2px]",
                  heatmapCellTone(cell),
                )}
                style={intensity > 0 ? { opacity: intensity } : undefined}
                title={t(($) => $.usage.heatmap.cell, {
                  weekday,
                  hour,
                  detail: tokenLabel,
                })}
              />,
            );
          }
          return row;
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{t(($) => $.usage.heatmap.hoursInUtc)}</span>
        <span className="flex items-center gap-1">
          {t(($) => $.usage.heatmap.less)}
          {[0.15, 0.36, 0.57, 0.78, 1].map((opacity) => (
            <span
              key={opacity}
              className="inline-block size-2.5 rounded-[2px] bg-primary"
              style={{ opacity }}
            />
          ))}
          {t(($) => $.usage.heatmap.more)}
        </span>
      </div>
      <ul className="sr-only">
        {report.heatmap.map((cell) => (
          <li key={`${cell.weekday}:${cell.hour}`}>
            {t(($) => $.usage.heatmap.cell, {
              weekday: weekdays[WEEKDAY_KEYS[cell.weekday]],
              hour: cell.hour,
              detail:
                cell.tokenTotal === null
                  ? t(($) => $.usage.heatmap.tokenUnavailable)
                  : t(($) => $.usage.counts.tokens, {
                      count: cell.tokenTotal,
                      total: formatNumber(cell.tokenTotal),
                    }),
            })}
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
}: Readonly<{
  title: string;
  rows: UsageBreakdown[];
  labelForKey?: (value: string) => string;
  onSelect?: (value: string) => void;
  icon?: (value: string) => ReactNode;
}>) {
  const { t } = useTranslation(["usage"]);
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
      <h3 className="border-b px-3 py-2 text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">{t(($) => $.usage.breakdown.empty)}</p>
      ) : (
        <Table containerClassName="max-h-64 overflow-x-auto" className="min-w-[24rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t(($) => $.usage.breakdown.name)}</TableHead>
              <TableHead numeric>{t(($) => $.usage.breakdown.tokens)}</TableHead>
              <TableHead numeric>{t(($) => $.usage.breakdown.cost)}</TableHead>
              <TableHead numeric>{t(($) => $.usage.breakdown.sessions)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const cost = costCell(row.estimatedCostUsd, row);
              const label = labelForKey(row.key);
              const selectable = onSelect && row.key !== "Unknown";
              return (
                <TableRow key={row.key} data-key={row.key}>
                  <TableCell className="min-w-[10rem]">
                    <span className="flex min-w-0 items-center gap-2">
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
                  <TableCell
                    numeric
                    title={t(($) => $.usage.trend.inOut, {
                      input: tokenCell(row.inputTotal),
                      output: tokenCell(row.outputTotal),
                    })}
                  >
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
}: Readonly<{
  report: UsageReportData;
  projectNames: ReadonlyMap<string, string>;
  onSelectFilter?: UsageReportProps["onSelectFilter"];
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}>) {
  const { t } = useTranslation(["usage"]);
  const { items, page, pageSize, total } = report.sessions;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const renderSession = (session: UsageSessionDetail) => {
    const cost = costCell(session.estimatedCostUsd, session, session.billingMode);
    const scope = scopeLabel(session.scope);
    return (
      <TableRow key={session.sessionId} data-session-id={session.sessionId}>
        <TableCell className="min-w-[12rem] whitespace-nowrap">
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
        <TableCell className="min-w-[12rem] whitespace-nowrap" data-project-id={session.projectId}>
          <Truncated value={session.projectId} label={projectLabel(session.projectId, projectNames)} />
        </TableCell>
        <TableCell className="min-w-[9rem] whitespace-nowrap" data-runtime-id={session.runtimeId}>
          {runtimeLabel(session.runtimeId)}
        </TableCell>
        <TableCell className="min-w-[11rem] whitespace-nowrap">
          <span className="flex items-center gap-2">
            {session.providerId && session.providerId !== "Mixed" && (
              <ProviderLogo providerId={session.providerId} size={14} />
            )}
            <Truncated
              value={session.modelId ?? t(($) => $.usage.labels.unknown)}
              className="max-w-[10rem]"
            />
          </span>
        </TableCell>
        <TableCell className="min-w-[11rem] whitespace-nowrap tabular-nums text-muted-foreground">
          {formatUtcTime(session.occurredAtMs)}
        </TableCell>
        <TableCell numeric>{tokenCell(session.inputTotal)}</TableCell>
        <TableCell numeric>{tokenCell(session.outputTotal)}</TableCell>
        <TableCell numeric>
          <Tooltip
            label={[
              cost.note,
              session.priceVersion
                ? t(($) => $.usage.cost.priceSource, { version: session.priceVersion })
                : null,
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
          <h3 className="text-sm font-medium">{t(($) => $.usage.sessions.title)}</h3>
          <p className="text-[11px] text-muted-foreground">
            {t(($) => $.usage.sessions.subtitle)}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">{sessionsCount(total)}</span>
      </div>
      {items.length === 0 ? (
        <Empty className="px-6 py-10">
          <EmptyHeader>
            <EmptyTitle className="text-base">
              {t(($) => $.usage.sessions.emptyTitle)}
            </EmptyTitle>
            <EmptyDescription>{t(($) => $.usage.sessions.emptyDescription)}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table containerClassName="max-h-[28rem] overflow-x-auto" className="min-w-[1180px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-[12rem]">{t(($) => $.usage.sessions.session)}</TableHead>
              <TableHead className="min-w-[12rem]">{t(($) => $.usage.sessions.project)}</TableHead>
              <TableHead className="min-w-[9rem]">{t(($) => $.usage.sessions.agent)}</TableHead>
              <TableHead className="min-w-[11rem]">{t(($) => $.usage.sessions.model)}</TableHead>
              <TableHead className="min-w-[11rem] whitespace-nowrap">
                {t(($) => $.usage.sessions.lastActivity)}
              </TableHead>
              <TableHead numeric>{t(($) => $.usage.sessions.input)}</TableHead>
              <TableHead numeric>{t(($) => $.usage.sessions.output)}</TableHead>
              <TableHead numeric>{t(($) => $.usage.sessions.cost)}</TableHead>
              <TableHead>{t(($) => $.usage.sessions.billing)}</TableHead>
              <TableHead>{t(($) => $.usage.sessions.status)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{items.map(renderSession)}</TableBody>
        </Table>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t(($) => $.usage.sessions.rowsPerPage)}</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange?.(Number(value))}
          >
            <SelectTrigger
              className="h-7 w-[4.5rem] text-xs"
              aria-label={t(($) => $.usage.sessions.rowsPerPage)}
            >
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
          <span className="text-xs text-muted-foreground">
            {t(($) => $.usage.sessions.page, { page: page + 1, pageCount })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={page === 0}
            onClick={() => onPageChange?.(page - 1)}
          >
            {t(($) => $.usage.sessions.previous)}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={(page + 1) * pageSize >= total}
            onClick={() => onPageChange?.(page + 1)}
          >
            {t(($) => $.usage.sessions.next)}
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
}: Readonly<UsageReportProps>) {
  const { t } = useTranslation(["usage"]);
  const totals = report.totals;
  const [exporting, setExporting] = useState(false);
  const cost = costCell(totals.costKnownRecords > 0 ? totals.estimatedCostUsd : null, totals);
  const costDetail = [
    totals.unpricedRecords > 0
      ? t(($) => $.usage.counts.unpriced, {
          count: totals.unpricedRecords,
          total: formatNumber(totals.unpricedRecords),
        })
      : null,
    totals.planRecords > 0
      ? t(($) => $.usage.counts.onPlan, {
          count: totals.planRecords,
          total: formatNumber(totals.planRecords),
        })
      : null,
  ].filter((entry): entry is string => entry !== null);
  const cachePercent = formatNumber((totals.cacheRate ?? 0) * 100, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  let cacheDetail: string;
  if (totals.cacheRate === null) {
    cacheDetail = t(($) => $.usage.counts.cacheUnknown, {
      count: totals.cacheUnknownRecords,
      total: formatNumber(totals.cacheUnknownRecords),
    });
  } else if (totals.cacheUnknownRecords > 0) {
    cacheDetail = t(($) => $.usage.cache.rateWithUnknown, {
      percent: cachePercent,
      unknown: formatNumber(totals.cacheUnknownRecords),
    });
  } else {
    cacheDetail = t(($) => $.usage.cache.rate, { percent: cachePercent });
  }

  const exportReport = async () => {
    setExporting(true);
    try {
      const saved = await onExport(report);
      if (typeof saved === "string") {
        toast.success(t(($) => $.usage.report.exportSaved, { path: saved }));
      }
    } catch (error) {
      notifyError("usage export", error, t(($) => $.usage.report.exportFailed));
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
            {t(($) => $.usage.report.costDisclaimer)}
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
          {t(($) => $.usage.report.exportCsv)}
        </Button>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          label={t(($) => $.usage.report.inputTokens)}
          value={
            totals.inputKnownRecords > 0
              ? formatExact(totals.inputTotal)
              : t(($) => $.usage.labels.unknown)
          }
          detail={
            totals.inputUnknownRecords > 0
              ? t(($) => $.usage.counts.inputUnknown, {
                  count: totals.inputUnknownRecords,
                  total: formatNumber(totals.inputUnknownRecords),
                })
              : t(($) => $.usage.report.inputIncludesCache)
          }
        />
        <Metric
          label={t(($) => $.usage.report.outputTokens)}
          value={
            totals.outputKnownRecords > 0
              ? formatExact(totals.outputTotal)
              : t(($) => $.usage.labels.unknown)
          }
          detail={
            totals.outputUnknownRecords > 0
              ? t(($) => $.usage.counts.outputUnknown, {
                  count: totals.outputUnknownRecords,
                  total: formatNumber(totals.outputUnknownRecords),
                })
              : t(($) => $.usage.report.outputIncludesReasoning)
          }
        />
        <Metric
          label={t(($) => $.usage.report.cacheReads)}
          value={
            totals.cacheKnownRecords > 0
              ? formatExact(totals.cacheReadTotal)
              : t(($) => $.usage.labels.unknown)
          }
          detail={cacheDetail}
        />
        <Metric
          label={t(($) => $.usage.report.costEstimate)}
          value={cost.text}
          detail={
            costDetail.length > 0
              ? joinNotes(costDetail)
              : t(($) => $.usage.report.allRecordsPriced)
          }
        />
        <Metric
          label={t(($) => $.usage.report.sessions)}
          value={formatExact(totals.sessionCount)}
          detail={joinNotes([
            t(($) => $.usage.counts.childRuns, {
              count: totals.childRunCount,
              total: formatNumber(totals.childRunCount),
            }),
            t(($) => $.usage.counts.usageRecords, {
              count: totals.recordCount,
              total: formatNumber(totals.recordCount),
            }),
          ])}
        />
      </dl>

      {(totals.excludedChildRecords > 0 || totals.unavailableRecords > 0) && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {totals.excludedChildRecords > 0 && (
            <p>
              {t(($) => $.usage.counts.excludedChildRecords, {
                count: totals.excludedChildRecords,
                total: formatNumber(totals.excludedChildRecords),
              })}
            </p>
          )}
          {totals.unavailableRecords > 0 && (
            <p>
              {t(($) => $.usage.counts.unmeasured, {
                count: totals.unavailableRecords,
                total: formatNumber(totals.unavailableRecords),
              })}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">{t(($) => $.usage.report.dailyTokens)}</h3>
          <UsageTrend report={report} />
        </section>
        <section className="overflow-x-auto rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">{t(($) => $.usage.report.activityByHour)}</h3>
          <UsageHeatmap report={report} />
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BreakdownTable
          title={t(($) => $.usage.report.projects)}
          rows={report.byProject}
          labelForKey={(value) => projectLabel(value, projectNames)}
          onSelect={onSelectFilter ? (value) => onSelectFilter("project", value) : undefined}
        />
        <BreakdownTable
          title={t(($) => $.usage.report.agents)}
          rows={report.byRuntime}
          labelForKey={runtimeLabel}
          onSelect={onSelectFilter ? (value) => onSelectFilter("runtime", value) : undefined}
        />
        <BreakdownTable
          title={t(($) => $.usage.report.providers)}
          rows={report.byProvider}
          labelForKey={providerLabel}
          icon={(value) =>
            value === "Unknown" ? null : <ProviderLogo providerId={value} size={14} />
          }
          onSelect={onSelectFilter ? (value) => onSelectFilter("provider", value) : undefined}
        />
        <BreakdownTable
          title={t(($) => $.usage.report.models)}
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
}: Readonly<{
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  allLabel: string;
}>) {
  return (
    <div className="min-w-0 space-y-1">
      <span className="block text-[11px] leading-4 text-muted-foreground">{label}</span>
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
}: Readonly<UsageReportDialogProps>) {
  const { t } = useTranslation(["usage"]);
  const quickRangeLabels: Record<UsageQuickRange, string> = {
    "7d": t(($) => $.usage.quickRanges.days7),
    "30d": t(($) => $.usage.quickRanges.days30),
    "90d": t(($) => $.usage.quickRanges.days90),
    month: t(($) => $.usage.quickRanges.month),
  };
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

  const loadedReport = () => {
    const data = reportQuery.data;
    if (!data) return null;
    if (data.totals.recordCount === 0) {
      return (
        <Empty className="min-h-56">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BarChart3 className="size-5" />
            </EmptyMedia>
            <EmptyTitle>{t(($) => $.usage.dialog.emptyTitle)}</EmptyTitle>
            <EmptyDescription>{t(($) => $.usage.dialog.emptyDescription)}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    }
    return (
      <UsageReport
        report={data}
        projectNames={projectNames}
        onSelectFilter={chooseFilter}
        onPageChange={(page) => setFilter((current) => ({ ...current, page }))}
        onPageSizeChange={(pageSize) =>
          setFilter((current) => ({ ...current, pageSize, page: 0 }))
        }
      />
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="flex h-[min(90vh,900px)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
          <DialogTitle>{t(($) => $.usage.dialog.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.usage.dialog.description)}</DialogDescription>
        </DialogHeader>

        <form
          className="shrink-0 space-y-3 border-b bg-muted/20 px-6 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            setFilter((current) => filterFromDraft(draft, current));
          }}
        >
          <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
            <div className="space-y-1">
              <span className="block text-[11px] leading-4 text-muted-foreground">
                {t(($) => $.usage.dialog.from)}
              </span>
              <DatePicker
                aria-label={t(($) => $.usage.dialog.from)}
                value={draft.start}
                max={draft.end || today}
                buttonClassName="h-8 w-40 text-xs"
                onChange={(value) => setDraftValue("start", value ?? draft.start)}
              />
            </div>
            <div className="space-y-1">
              <span className="block text-[11px] leading-4 text-muted-foreground">
                {t(($) => $.usage.dialog.through)}
              </span>
              <DatePicker
                aria-label={t(($) => $.usage.dialog.through)}
                value={draft.end}
                min={draft.start}
                max={today}
                buttonClassName="h-8 w-40 text-xs"
                onChange={(value) => setDraftValue("end", value ?? draft.end)}
              />
            </div>
            <fieldset className="flex h-8 items-center gap-0.5 rounded-md border bg-background p-0.5">
              <legend className="sr-only">{t(($) => $.usage.dialog.quickRangesLegend)}</legend>
              {USAGE_QUICK_RANGES.map((range) => (
                <Button
                  key={range.id}
                  type="button"
                  size="xs"
                  variant="ghost"
                  aria-pressed={quickRange === range.id}
                  className={cn(
                    "h-6.5 rounded-[5px] px-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground",
                    quickRange === range.id && "bg-secondary text-foreground shadow-sm hover:bg-secondary",
                  )}
                  onClick={() => applyQuickRange(range.id)}
                >
                  {quickRangeLabels[range.id]}
                </Button>
              ))}
            </fieldset>
            <span className="flex h-8 items-center text-[11px] text-muted-foreground">
              {t(($) => $.usage.dialog.utcNote)}
            </span>
            <div className="ml-auto flex h-8 items-center gap-2">
              <Button type="submit" size="sm" className="h-8 px-5">
                {t(($) => $.usage.dialog.apply)}
              </Button>
              <Tooltip label={t(($) => $.usage.dialog.refresh)}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 w-8 px-0"
                  aria-label={t(($) => $.usage.dialog.refreshLabel)}
                  onClick={() => void reportQuery.refetch()}
                >
                  <RefreshCw aria-hidden="true" className={cn(reportQuery.isFetching && "motion-safe:animate-spin")} />
                </Button>
              </Tooltip>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <FilterSelect
              label={t(($) => $.usage.filters.project)}
              value={draft.project}
              options={choices.project}
              allLabel={t(($) => $.usage.filters.projectAll)}
              onChange={(value) => setDraftValue("project", value)}
            />
            <FilterSelect
              label={t(($) => $.usage.filters.agent)}
              value={draft.runtime}
              options={choices.runtime}
              allLabel={t(($) => $.usage.filters.agentAll)}
              onChange={(value) => setDraftValue("runtime", value)}
            />
            <FilterSelect
              label={t(($) => $.usage.filters.provider)}
              value={draft.provider}
              options={choices.provider}
              allLabel={t(($) => $.usage.filters.providerAll)}
              onChange={(value) => setDraftValue("provider", value)}
            />
            <FilterSelect
              label={t(($) => $.usage.filters.model)}
              value={draft.model}
              options={choices.model}
              allLabel={t(($) => $.usage.filters.modelAll)}
              onChange={(value) => setDraftValue("model", value)}
            />
            <FilterSelect
              label={t(($) => $.usage.filters.session)}
              value={draft.session}
              options={choices.session}
              allLabel={t(($) => $.usage.filters.sessionAll)}
              onChange={(value) => setDraftValue("session", value)}
            />
          </div>
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {reportQuery.isPending && (
            <div role="status" className="grid min-h-56 place-items-center text-sm text-muted-foreground">
              {t(($) => $.usage.dialog.loading)}
            </div>
          )}
          {reportQuery.isError && (
            <div role="alert" className="grid min-h-56 place-items-center text-center">
              <div>
                <p className="font-medium">{t(($) => $.usage.dialog.loadFailed)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {reportQuery.error instanceof Error
                    ? reportQuery.error.message
                    : t(($) => $.usage.dialog.loadFailedHint)}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => void reportQuery.refetch()}
                >
                  {t(($) => $.usage.dialog.tryAgain)}
                </Button>
              </div>
            </div>
          )}
          {loadedReport()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
