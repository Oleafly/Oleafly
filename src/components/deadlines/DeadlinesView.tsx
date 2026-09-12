import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CalendarX2,
  Clock3,
  ExternalLink,
  Globe2,
  HelpCircle,
  MapPin,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import {
  countdown,
  deadlineInstant,
  filterVenues,
  nextDeadline,
  sortVenues,
  urgency,
  type SortKey,
  type Venue,
} from "@/lib/deadlines";
import { i18n } from "@/i18n";
import { formatDate, formatNumber } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { useDeadlinesStore } from "@/store/deadlines";
import { useHomeViewStore } from "@/store/home-view";

function pad(number: number): string {
  return String(number).padStart(2, "0");
}

export function subLabel(sub: string): string {
  switch (sub) {
    case "AI":
      return i18n.t(($) => $.library.deadlines.areas.AI);
    case "CG":
      return i18n.t(($) => $.library.deadlines.areas.CG);
    case "CT":
      return i18n.t(($) => $.library.deadlines.areas.CT);
    case "CV":
      return i18n.t(($) => $.library.deadlines.areas.CV);
    case "DB":
      return i18n.t(($) => $.library.deadlines.areas.DB);
    case "DS":
      return i18n.t(($) => $.library.deadlines.areas.DS);
    case "HI":
      return i18n.t(($) => $.library.deadlines.areas.HI);
    case "MX":
      return i18n.t(($) => $.library.deadlines.areas.MX);
    case "NW":
      return i18n.t(($) => $.library.deadlines.areas.NW);
    case "SC":
      return i18n.t(($) => $.library.deadlines.areas.SC);
    case "SE":
      return i18n.t(($) => $.library.deadlines.areas.SE);
    case "NEURO":
      return i18n.t(($) => $.library.deadlines.areas.NEURO);
    case "PHYS":
      return i18n.t(($) => $.library.deadlines.areas.PHYS);
    case "MAT":
      return i18n.t(($) => $.library.deadlines.areas.MAT);
    case "RO":
      return i18n.t(($) => $.library.deadlines.areas.RO);
    default:
      return sub;
  }
}

interface FieldStyle {
  badge: string;
  icon: string;
}

const DEFAULT_FIELD_STYLE: FieldStyle = {
  badge:
    "border-slate-500/25 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  icon: "border-slate-500/25 bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

const FIELD_STYLES: Record<string, FieldStyle> = {
  AI: {
    badge:
      "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    icon: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  CG: {
    badge:
      "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    icon: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  CT: DEFAULT_FIELD_STYLE,
  CV: {
    badge:
      "border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
    icon: "border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  },
  DB: {
    badge:
      "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    icon: "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  DS: {
    badge:
      "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    icon: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  HI: {
    badge:
      "border-pink-500/25 bg-pink-500/10 text-pink-700 dark:text-pink-300",
    icon: "border-pink-500/25 bg-pink-500/10 text-pink-700 dark:text-pink-300",
  },
  MX: {
    badge:
      "border-purple-500/25 bg-purple-500/10 text-purple-700 dark:text-purple-300",
    icon: "border-purple-500/25 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  },
  NW: {
    badge:
      "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    icon: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  SC: {
    badge:
      "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
    icon: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  },
  SE: {
    badge:
      "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    icon: "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  NEURO: {
    badge:
      "border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
    icon: "border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  },
  PHYS: {
    badge:
      "border-teal-500/25 bg-teal-500/10 text-teal-700 dark:text-teal-300",
    icon: "border-teal-500/25 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  },
  MAT: {
    badge:
      "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    icon: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  RO: {
    badge:
      "border-lime-500/25 bg-lime-500/10 text-lime-700 dark:text-lime-300",
    icon: "border-lime-500/25 bg-lime-500/10 text-lime-700 dark:text-lime-300",
  },
};

const URGENCY_STYLE = {
  critical: {
    panel: "border-red-500/25 bg-red-500/5",
    text: "text-red-700 dark:text-red-300",
  },
  soon: {
    panel: "border-amber-500/25 bg-amber-500/5",
    text: "text-amber-700 dark:text-amber-300",
  },
  comfortable: {
    panel: "border-emerald-500/25 bg-emerald-500/5",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  passed: {
    panel: "border-slate-500/20 bg-slate-500/5",
    text: "text-muted-foreground",
  },
} as const;

function formatUpdated(raw: string | null): string | null {
  if (!raw) return null;
  const legacy = raw.match(/^epoch:(\d+)$/);
  const timestamp = raw.replace(/\s+\(bundled seed\)$/, "");
  const date = legacy
    ? new Date(Number(legacy[1]) * 1000)
    : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return raw;
  return formatDate(date, { year: "numeric", month: "short", day: "numeric" });
}

function formatDeadlineKind(kind: string): string {
  return kind
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDeadlineMoment(venue: Venue, when: Date): string {
  const entry = venue.deadlines.find(
    (deadline) =>
      deadlineInstant(deadline.at, venue.timezone).getTime() === when.getTime(),
  );
  const match = entry?.at.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):\d{2}$/,
  );
  if (!match) return venue.timezone;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const hour = Number(match[4]);
  const hour12 = hour % 12 || 12;
  const period = hour >= 12 ? "PM" : "AM";
  return `${months[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]} at ${hour12}:${match[5]} ${period} ${venue.timezone}`;
}

function HelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const { t } = useTranslation(["library"]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(($) => $.library.deadlines.help.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.library.deadlines.help.description)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
          <div>
            <h3 className="font-medium text-foreground">
              {t(($) => $.library.deadlines.help.timezonesTitle)}
            </h3>
            <p className="mt-1">{t(($) => $.library.deadlines.help.timezonesBody)}</p>
          </div>
          <div>
            <h3 className="font-medium text-foreground">
              {t(($) => $.library.deadlines.help.estimatedTitle)}
            </h3>
            <p className="mt-1">{t(($) => $.library.deadlines.help.estimatedBody)}</p>
          </div>
          <div>
            <h3 className="font-medium text-foreground">
              {t(($) => $.library.deadlines.help.sourcesTitle)}
            </h3>
            <p className="mt-1">{t(($) => $.library.deadlines.help.sourcesBody)}</p>
          </div>
          <p className="rounded-md border bg-muted/30 p-3 text-foreground">
            {t(($) => $.library.deadlines.help.confirm)}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CountdownUnit({
  unit,
  value,
  label,
}: {
  unit: string;
  value: number;
  label: string;
}) {
  return (
    <div
      className="min-w-0"
      data-countdown-unit={unit}
      data-countdown-value={value}
    >
      <div className="font-mono text-xl font-semibold tabular-nums">
        {pad(value)}
      </div>
      <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] opacity-70">
        {label}
      </div>
    </div>
  );
}

function DeadlineCountdown({ venue, now }: { venue: Venue; now: Date }) {
  const { t } = useTranslation(["library"]);
  const next = nextDeadline(venue, now);
  const urgencyKey = next ? urgency(next.when, now) : "passed";
  const style = URGENCY_STYLE[urgencyKey];
  if (!next) {
    return (
      <div className={cn("rounded-lg border p-3.5", style.panel)}>
        <p className={cn("text-sm font-medium", style.text)}>
          {t(($) => $.library.deadlines.allPassed)}
        </p>
      </div>
    );
  }

  const remaining = countdown(next.when, now);
  if (!remaining) return null;
  return (
    <div className={cn("rounded-lg border p-3.5", style.panel)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t(($) => $.library.deadlines.nextDeadline, { kind: formatDeadlineKind(next.kind) })}
        </p>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
            style.panel,
            style.text,
          )}
        >
          {urgencyKey === "critical"
            ? t(($) => $.library.deadlines.urgency.critical)
            : urgencyKey === "soon"
              ? t(($) => $.library.deadlines.urgency.soon)
              : t(($) => $.library.deadlines.urgency.comfortable)}
        </span>
      </div>
      <div className={cn("mt-2.5 grid grid-cols-4 gap-3", style.text)}>
        <CountdownUnit
          unit="days"
          value={remaining.days}
          label={t(($) => $.library.deadlines.units.days)}
        />
        <CountdownUnit
          unit="hours"
          value={remaining.hours}
          label={t(($) => $.library.deadlines.units.hours)}
        />
        <CountdownUnit
          unit="minutes"
          value={remaining.minutes}
          label={t(($) => $.library.deadlines.units.minutes)}
        />
        <CountdownUnit
          unit="seconds"
          value={remaining.seconds}
          label={t(($) => $.library.deadlines.units.seconds)}
        />
      </div>
      <Tooltip
        label={t(($) => $.library.deadlines.timezoneTooltip, { timezone: venue.timezone })}
      >
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock3 className="size-3.5" />
          {formatDeadlineMoment(venue, next.when)}
        </p>
      </Tooltip>
    </div>
  );
}

function DeadlineCard({ venue, now }: { venue: Venue; now: Date }) {
  const { t } = useTranslation(["library"]);
  const fieldStyle = FIELD_STYLES[venue.sub] ?? DEFAULT_FIELD_STYLE;
  return (
    <article
      data-testid={`deadline-card-${venue.id}`}
      className={cn(
        "flex min-h-[22rem] flex-col rounded-xl border bg-gradient-to-br from-card via-card to-muted/20 p-5 shadow-sm transition-colors hover:bg-muted/15",
        venue.estimated ? "border-dashed" : "border-border/80",
      )}
    >
      <div className="flex items-start gap-3.5">
        <div
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-lg border",
            fieldStyle.icon,
          )}
        >
          <CalendarClock className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold sm:text-lg">
              {venue.title}
            </h2>
            {venue.rank && (
              <Tooltip
                label={
                  venue.rank.startsWith("CCF")
                    ? t(($) => $.library.deadlines.rankCcf)
                    : t(($) => $.library.deadlines.rankCore)
                }
              >
                <span className="rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {venue.rank}
                </span>
              </Tooltip>
            )}
            {venue.estimated && (
              <Tooltip label={t(($) => $.library.deadlines.estimatedTooltip)}>
                <span className="rounded border border-dashed px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-muted-foreground">
                  {t(($) => $.library.deadlines.estimatedBadge)}
                </span>
              </Tooltip>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {venue.full_name}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Tooltip label={subLabel(venue.sub)}>
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium",
              fieldStyle.badge,
            )}
          >
            {venue.sub}
          </span>
        </Tooltip>
        <span className="rounded-full border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground">
          {subLabel(venue.sub)}
        </span>
      </div>

      <div className="mt-4">
        <DeadlineCountdown venue={venue} now={now} />
      </div>

      <div className="mt-auto space-y-2.5 pt-4 text-xs text-muted-foreground">
        {venue.conf_date && (
          <div className="flex items-start gap-2">
            <CalendarDays className="mt-0.5 size-3.5 shrink-0" />
            <span>{venue.conf_date}</span>
          </div>
        )}
        {venue.place && (
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-3.5 shrink-0" />
            <span>{venue.place}</span>
          </div>
        )}
        {venue.link && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary"
            onClick={() => void openExternal(venue.link)}
          >
            <Globe2 /> {t(($) => $.library.deadlines.officialWebsite)}
            <ExternalLink className="opacity-60" />
          </Button>
        )}
      </div>
    </article>
  );
}

function DeadlineSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div
          key={index}
          className="min-h-[22rem] animate-pulse rounded-xl border p-5"
        >
          <div className="flex gap-3.5">
            <div className="size-11 rounded-lg bg-muted" />
            <div className="flex-1">
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="mt-2.5 h-3 w-full rounded bg-muted" />
            </div>
          </div>
          <div className="mt-5 h-7 w-40 rounded-full bg-muted" />
          <div className="mt-5 h-32 rounded-lg bg-muted/70" />
          <div className="mt-5 h-3 w-1/2 rounded bg-muted" />
          <div className="mt-3 h-8 w-36 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function DeadlineStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "red" | "amber" | "violet";
}) {
  const toneClass = {
    red: "border-red-500/20 bg-red-500/5 text-red-700 dark:text-red-300",
    amber:
      "border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300",
    violet:
      "border-violet-500/20 bg-violet-500/5 text-violet-700 dark:text-violet-300",
  }[tone];
  return (
    <div className={cn("rounded-lg border px-3.5 py-3", toneClass)}>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] opacity-75">
        {label}
      </p>
    </div>
  );
}

export function DeadlinesView() {
  const { t } = useTranslation(["common", "library"]);
  const activePage = useHomeViewStore((state) => state.page);
  const venues = useDeadlinesStore((state) => state.venues);
  const generatedAt = useDeadlinesStore((state) => state.generatedAt);
  const busy = useDeadlinesStore((state) => state.busy);
  const error = useDeadlinesStore((state) => state.error);
  const openView = useDeadlinesStore((state) => state.openView);
  const refresh = useDeadlinesStore((state) => state.refresh);
  const [now, setNow] = useState(() => new Date());
  const [sub, setSub] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showPassed, setShowPassed] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("deadline");
  const [helpOpen, setHelpOpen] = useState(false);
  const active = activePage === "deadlines";

  // biome-ignore lint/correctness/useExhaustiveDependencies: openView is a stable store action, re-running it on every countdown tick would refetch on each countdown tick
  useEffect(() => {
    if (active) void openView();
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const subs = useMemo(
    () =>
      [...new Set((venues ?? []).map((venue) => venue.sub).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b)),
    [venues],
  );
  const shown = useMemo(
    () =>
      sortVenues(
        filterVenues(venues ?? [], {
          sub,
          query,
          showPassed,
          now,
        }),
        sortKey,
        now,
      ),
    [venues, sub, query, showPassed, sortKey, now],
  );
  const stats = useMemo(() => {
    let withinSevenDays = 0;
    let withinThirtyDays = 0;
    let estimated = 0;
    for (const venue of shown) {
      if (venue.estimated) estimated++;
      const next = nextDeadline(venue, now);
      if (!next) continue;
      const days =
        (next.when.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
      if (days <= 7) withinSevenDays++;
      if (days <= 30) withinThirtyDays++;
    }
    return { withinSevenDays, withinThirtyDays, estimated };
  }, [now, shown]);
  const updated = formatUpdated(generatedAt);
  const filtersActive =
    Boolean(query.trim()) ||
    sub !== null ||
    showPassed ||
    sortKey !== "deadline";

  const clearFilters = () => {
    setQuery("");
    setSub(null);
    setShowPassed(false);
    setSortKey("deadline");
  };

  if (!active) return null;
  return (
    <>
      <ToolPageShell
        page="deadlines"
        title={t(($) => $.library.deadlines.title)}
        subtitle={t(($) => $.library.deadlines.subtitle)}
        icon={CalendarClock}
        testId="deadlines-view"
        actions={
          <div className="flex items-center gap-1.5">
            {updated && (
              <Tooltip label={t(($) => $.library.deadlines.updatedTooltip)}>
                <span className="hidden text-xs text-muted-foreground md:inline">
                  {t(($) => $.library.deadlines.updated, { date: updated })}
                </span>
              </Tooltip>
            )}
            <Tooltip
              label={
                busy
                  ? t(($) => $.library.deadlines.refreshing)
                  : t(($) => $.library.deadlines.refresh)
              }
            >
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                disabled={busy}
                aria-label={
                  busy
                    ? t(($) => $.library.deadlines.refreshingLabel)
                    : t(($) => $.library.deadlines.refresh)
                }
                data-testid="deadlines-refresh"
                onClick={() => void refresh()}
              >
                <RefreshCw
                  className={cn("size-4", busy && "animate-spin")}
                />
              </Button>
            </Tooltip>
            <Tooltip label={t(($) => $.library.deadlines.about)}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t(($) => $.library.deadlines.about)}
                data-testid="deadlines-help"
                onClick={() => setHelpOpen(true)}
              >
                <HelpCircle className="size-4" />
              </Button>
            </Tooltip>
          </div>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col bg-background">
          <section className="shrink-0 border-b bg-card/35">
            <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 sm:py-6">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                  {t(($) => $.library.deadlines.title)}
                </p>
                <span className="h-4 w-px bg-border" />
                <span className="text-[11px] text-muted-foreground">
                  {t(($) => $.library.deadlines.eyebrow)}
                </span>
              </div>
              <div className="mt-2 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                    {t(($) => $.library.deadlines.heading)}
                  </h1>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                    {t(($) => $.library.deadlines.intro)}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <DeadlineStat
                    label={t(($) => $.library.deadlines.stats.next7Days)}
                    value={stats.withinSevenDays}
                    tone="red"
                  />
                  <DeadlineStat
                    label={t(($) => $.library.deadlines.stats.next30Days)}
                    value={stats.withinThirtyDays}
                    tone="amber"
                  />
                  <DeadlineStat
                    label={t(($) => $.library.deadlines.stats.estimated)}
                    value={stats.estimated}
                    tone="violet"
                  />
                </div>
              </div>

              <div className="mt-5 flex items-center gap-2 rounded-lg border bg-background p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
                <Search className="ml-2 size-5 shrink-0 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t(($) => $.library.deadlines.searchPlaceholder)}
                  aria-label={t(($) => $.library.deadlines.searchLabel)}
                  className="h-11 min-w-0 flex-1 border-0 bg-transparent px-1 text-base shadow-none focus-visible:ring-0"
                  data-testid="deadlines-search"
                />
                {query && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setQuery("")}
                  >
                    {t(($) => $.common.actions.clear)}
                  </Button>
                )}
              </div>

              <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={sub ?? "__all__"}
                    onValueChange={(value) =>
                      setSub(value === "__all__" ? null : value)
                    }
                  >
                    <SelectTrigger
                      className="h-9 w-64 bg-background text-sm"
                      aria-label={t(($) => $.library.deadlines.areaLabel)}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">
                        {t(($) => $.library.deadlines.allAreas)}
                      </SelectItem>
                      {subs.map((area) => (
                        <SelectItem
                          key={area}
                          value={area}
                          data-testid={`deadlines-sub-${area}`}
                        >
                          {t(($) => $.library.deadlines.areaOption, {
                            code: area,
                            label: subLabel(area),
                          })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={sortKey}
                    onValueChange={(value) =>
                      setSortKey(value as SortKey)
                    }
                  >
                    <SelectTrigger
                      className="h-9 w-44 bg-background text-sm"
                      aria-label={t(($) => $.library.deadlines.sortLabel)}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="deadline">
                        {t(($) => $.library.deadlines.sortDeadline)}
                      </SelectItem>
                      <SelectItem value="name">
                        {t(($) => $.library.deadlines.sortName)}
                      </SelectItem>
                      <SelectItem value="field">
                        {t(($) => $.library.deadlines.sortField)}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <label
                    htmlFor="deadlines-show-passed"
                    className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md border bg-background px-3 text-sm text-muted-foreground"
                  >
                    <Switch
                      id="deadlines-show-passed"
                      checked={showPassed}
                      onCheckedChange={setShowPassed}
                      aria-label={t(($) => $.library.deadlines.includePassedLabel)}
                    />
                    {t(($) => $.library.deadlines.includePassed)}
                  </label>
                </div>
                {filtersActive && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                  >
                    <RotateCcw /> {t(($) => $.library.deadlines.resetFilters)}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground lg:ml-auto">
                  {t(($) => $.library.deadlines.venueCount, {
                    count: shown.length,
                    total: formatNumber(shown.length),
                  })}
                </p>
              </div>

              {error && (
                <div className="mt-3 flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {t(($) => $.library.deadlines.loadFailed)}
                </div>
              )}
            </div>
          </section>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6">
              <div className="mb-4 flex items-center justify-between border-b pb-4">
                <p className="text-sm font-medium">
                  {venues === null
                    ? t(($) => $.library.deadlines.loadingConferences)
                    : t(($) => $.library.deadlines.shown, {
                        count: shown.length,
                        total: formatNumber(shown.length),
                      })}
                </p>
                {updated && (
                  <p className="text-xs text-muted-foreground">
                    {t(($) => $.library.deadlines.datasetUpdated, { date: updated })}
                  </p>
                )}
              </div>

              {venues === null ? (
                <DeadlineSkeleton />
              ) : shown.length === 0 ? (
                <Empty className="min-h-[24rem]">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <CalendarX2 className="size-6" />
                    </EmptyMedia>
                    <EmptyTitle>{t(($) => $.library.deadlines.emptyTitle)}</EmptyTitle>
                    <EmptyDescription>
                      {t(($) => $.library.deadlines.emptyDescription)}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={clearFilters}
                    >
                      {t(($) => $.library.deadlines.clearFilters)}
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {shown.map((venue) => (
                    <DeadlineCard
                      key={venue.id}
                      venue={venue}
                      now={now}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </ToolPageShell>
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}
