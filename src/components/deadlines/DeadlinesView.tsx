import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CalendarX2,
  HelpCircle,
  MapPin,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Globe } from "lucide-react";
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
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import {
  countdown,
  filterVenues,
  nextDeadline,
  sortVenues,
  urgency,
  type SortKey,
  type Venue,
} from "@/lib/deadlines";
import { WHITE_PANEL, cn } from "@/lib/utils";
import { useDeadlinesStore } from "@/store/deadlines";
import { useHomeViewStore } from "@/store/home-view";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

const SUB_LABELS: Record<string, string> = {
  AI: "Artificial intelligence and machine learning",
  CG: "Computer graphics and multimedia",
  CT: "Theory of computation",
  CV: "Computer vision",
  DB: "Databases and data mining",
  DS: "Computer architecture, parallel and storage systems",
  HI: "Human-computer interaction",
  MX: "Interdisciplinary and emerging areas",
  NW: "Computer networks",
  SC: "Security and cryptography",
  SE: "Software engineering and programming languages",
  NEURO: "Neuroscience",
  PHYS: "Physics and optics",
  MAT: "Materials science",
  RO: "Robotics",
};

export function subLabel(sub: string): string {
  return SUB_LABELS[sub] ?? sub;
}

const URGENCY_COLOR: Record<ReturnType<typeof urgency>, string> = {
  critical: "text-red-500 dark:text-red-400",
  soon: "text-amber-600 dark:text-amber-400",
  comfortable: "text-emerald-600 dark:text-emerald-400",
};

function CountdownText({ venue, now }: { venue: Venue; now: Date }) {
  const next = nextDeadline(venue, now);
  if (!next) {
    return <span className="text-xs text-muted-foreground">All deadlines passed</span>;
  }
  const c = countdown(next.when, now);
  if (!c) return null;
  return (
    <Tooltip
      label={`Time left until the ${next.kind} deadline, in the venue's own timezone (${venue.timezone})`}
    >
      <span
        className={cn(
          "font-mono text-sm font-semibold",
          URGENCY_COLOR[urgency(next.when, now)],
        )}
      >
        {pad(c.days)}d : {pad(c.hours)}h : {pad(c.minutes)}m : {pad(c.seconds)}s
      </span>
    </Tooltip>
  );
}

function DeadlineKindBadge({ venue, now }: { venue: Venue; now: Date }) {
  const next = nextDeadline(venue, now);
  if (!next) return null;
  return (
    <Tooltip
      label={
        next.kind === "abstract"
          ? "Abstract registration closes first; the full paper deadline follows"
          : "Full paper submission deadline"
      }
    >
      <span className="shrink-0 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-secondary-foreground">
        {next.kind}
      </span>
    </Tooltip>
  );
}

function formatUpdated(raw: string | null): string | null {
  if (!raw) return null;
  const legacy = raw.match(/^epoch:(\d+)$/);
  const date = legacy ? new Date(Number(legacy[1]) * 1000) : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>About these deadlines</DialogTitle>
          <DialogDescription>How to read the board before you trust it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Every countdown runs in the timezone the venue's official call specifies. Most CS
            venues use Anywhere on Earth (AoE, UTC-12). Some do not: SfN closes on US Eastern
            time, while STOC and SPIE Photonics West use US Pacific.
          </p>
          <p>
            Entries marked <span className="font-mono text-[11px] font-semibold text-foreground">EST.</span>{" "}
            with a dashed border are projections from the venue's prior-year schedule; their
            official call has not been posted yet.
          </p>
          <p>
            Data comes from the open ccf-deadlines dataset plus venues we track directly:
            neurips.cc, corl.org, sfn.org, ccneuro.org, cosyne.org, humanbrainmapping.org,
            acm-stoc.org, spie.org, summit.aps.org, and mrs.org, cross-checked against
            community deadline hubs.
          </p>
          <p className="text-foreground">
            Always verify against the official call before submitting. The clock does not stop
            for mistakes.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeadlineCard({ venue, now }: { venue: Venue; now: Date }) {
  return (
    <div
      data-testid={`deadline-card-${venue.id}`}
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/25 hover:bg-accent/40",
        venue.estimated ? "border-dashed border-border" : "border-border/80",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{venue.title}</span>
        {venue.rank && (
          <Tooltip
            label={
              venue.rank.startsWith("CCF")
                ? "China Computer Federation venue ranking (A is highest)"
                : "CORE venue ranking (A* is highest)"
            }
          >
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {venue.rank}
            </span>
          </Tooltip>
        )}
        {venue.estimated && (
          <Tooltip label="Projected from the prior-year schedule; the official call has not been posted yet">
            <span className="rounded border border-dashed border-muted-foreground/40 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-muted-foreground">
              EST.
            </span>
          </Tooltip>
        )}
        <Tooltip label={subLabel(venue.sub)}>
          <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
            {venue.sub}
          </span>
        </Tooltip>
      </div>
      <div className="truncate text-xs text-muted-foreground">{venue.full_name}</div>
      <CountdownText venue={venue} now={now} />
      <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5">
        {venue.conf_date && (
          <Tooltip label="When the conference itself takes place">
            <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <CalendarDays className="size-3.5 shrink-0" />
              {venue.conf_date}
            </div>
          </Tooltip>
        )}
        <div className="col-start-2 row-start-1 justify-self-end">
          <DeadlineKindBadge venue={venue} now={now} />
        </div>
        {venue.place && (
          <Tooltip label="Conference location">
            <div className="col-start-1 row-start-2 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" />
              {venue.place}
            </div>
          </Tooltip>
        )}
        {venue.link && (
          <Tooltip label="Open the venue's official website for the call for papers">
            <Button
              variant="secondary"
              size="xs"
              className="col-start-2 row-start-2 shrink-0 justify-self-end"
              onClick={() => void openExternal(venue.link)}
            >
              <Globe className="size-3" /> Website
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export function DeadlinesView() {
  const deadlinesOpen = useHomeViewStore((s) => s.deadlinesOpen);
  const venues = useDeadlinesStore((s) => s.venues);
  const generatedAt = useDeadlinesStore((s) => s.generatedAt);
  const busy = useDeadlinesStore((s) => s.busy);
  const error = useDeadlinesStore((s) => s.error);
  const refresh = useDeadlinesStore((s) => s.refresh);
  const [now, setNow] = useState(() => new Date());
  const [sub, setSub] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showPassed, setShowPassed] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("deadline");
  const [helpOpen, setHelpOpen] = useState(false);
  const closeDeadlines = useHomeViewStore((s) => s.closeDeadlines);
  const active = deadlinesOpen;
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(active, closeDeadlines);

  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, [active]);

  const subs = useMemo(
    () => [...new Set((venues ?? []).map((v) => v.sub).filter(Boolean))].sort(),
    [venues],
  );
  const shown = useMemo(
    () => sortVenues(filterVenues(venues ?? [], { sub, query, showPassed, now }), sortKey, now),
    [venues, sub, query, showPassed, sortKey, now],
  );
  const updated = formatUpdated(generatedAt);

  if (!active) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close deadlines"
        className="absolute inset-0"
        onMouseDown={onBackdropMouseDown}
      />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="deadlines-title"
        data-modal-initial-focus
        data-testid="deadlines-view"
        className={cn(
          "dark relative flex h-[36rem] w-full max-w-4xl flex-col overflow-hidden rounded-xl text-foreground xl:h-[42rem] xl:max-w-6xl",
          WHITE_PANEL,
        )}
      >
      <div className="relative flex items-center gap-3 border-b py-3 pl-5 pr-4">
        <div id="deadlines-title" className="text-lg font-bold tracking-tight">Conference Deadlines</div>
        <div className="ml-auto flex items-center gap-2">
          {error && <span className="max-w-64 truncate text-xs text-destructive">{error}</span>}
          {updated && (
            <Tooltip label="When the deadline dataset was last fetched">
              <span className="font-mono text-xs text-muted-foreground">Updated {updated}</span>
            </Tooltip>
          )}
          <Tooltip label={busy ? "Refreshing..." : "Refresh"}>
            <Button
              variant="outline"
              size="icon"
              className="rounded-full"
              disabled={busy}
              aria-label={busy ? "Refreshing..." : "Refresh"}
              data-testid="deadlines-refresh"
              onClick={() => void refresh()}
            >
              <RefreshCw className={cn("size-4", busy && "animate-spin")} />
            </Button>
          </Tooltip>
          <Tooltip label="About these deadlines">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label="About these deadlines"
              data-testid="deadlines-help"
              onClick={() => setHelpOpen(true)}
            >
              <HelpCircle className="size-4" />
            </Button>
          </Tooltip>
          <Button variant="ghost" size="icon" className="size-7 rounded-full" onClick={closeDeadlines} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5">
        <Select value={sub ?? "__all__"} onValueChange={(v) => setSub(v === "__all__" ? null : v)}>
          <SelectTrigger className="h-8 w-44 rounded-full border-border/80 bg-card text-xs" aria-label="Filter by field">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All</SelectItem>
            {subs.map((s) => (
              <SelectItem key={s} value={s} data-testid={`deadlines-sub-${s}`}>
                {s} — {subLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conferences"
            className="h-8 rounded-full border-border/80 bg-card pl-9 text-xs"
            data-testid="deadlines-search"
          />
        </div>
        <div className="ml-auto flex items-center gap-4">
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger
              className="h-8 w-36 rounded-full border-border/80 bg-card text-xs"
              aria-label="Sort by"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="deadline">Deadline</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="field">Field</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Switch
              id="deadlines-show-passed"
              checked={showPassed}
              onCheckedChange={setShowPassed}
              aria-label="Show passed"
              className="data-[state=checked]:bg-blue-500 data-[state=unchecked]:bg-white/10 data-[state=unchecked]:border-white/10"
            />
            <label
              htmlFor="deadlines-show-passed"
              className="cursor-pointer text-xs text-muted-foreground"
            >
              Show passed
            </label>
          </div>
          <Tooltip label="Conference cycles currently listed with these filters">
            <span className="font-mono text-xs text-muted-foreground">{shown.length} entries</span>
          </Tooltip>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {venues === null ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : shown.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarX2 className="size-6" />
              </EmptyMedia>
              <EmptyTitle>No conferences match</EmptyTitle>
              <EmptyDescription>
                Try a different search, clear the field filter, or turn on Show passed.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setSub(null);
                }}
              >
                Clear filters
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {shown.map((v) => (
              <DeadlineCard key={v.id} venue={v} now={now} />
            ))}
          </div>
        )}
      </div>
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      </div>
    </div>
  );
}
