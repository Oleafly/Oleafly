import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  countdown,
  filterVenues,
  nextDeadline,
  sortByNextDeadline,
  type Venue,
} from "@/lib/deadlines";
import { useDeadlinesStore } from "@/store/deadlines";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function CountdownText({ venue, now }: { venue: Venue; now: Date }) {
  const next = nextDeadline(venue, now);
  if (!next) {
    return <span className="text-xs text-muted-foreground">All deadlines passed</span>;
  }
  const c = countdown(next.when, now);
  if (!c) return null;
  return (
    <div className="font-mono text-sm font-semibold text-amber-600 dark:text-amber-400">
      {pad(c.days)}d : {pad(c.hours)}h : {pad(c.minutes)}m : {pad(c.seconds)}s
      <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
        {next.kind}
      </span>
    </div>
  );
}

export function DeadlinesView() {
  const open = useDeadlinesStore((s) => s.open);
  const venues = useDeadlinesStore((s) => s.venues);
  const generatedAt = useDeadlinesStore((s) => s.generatedAt);
  const busy = useDeadlinesStore((s) => s.busy);
  const error = useDeadlinesStore((s) => s.error);
  const refresh = useDeadlinesStore((s) => s.refresh);
  const close = useDeadlinesStore((s) => s.close);
  const [now, setNow] = useState(() => new Date());
  const [sub, setSub] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showPassed, setShowPassed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, [open]);

  const subs = useMemo(
    () => [...new Set((venues ?? []).map((v) => v.sub).filter(Boolean))].sort(),
    [venues],
  );
  const shown = useMemo(
    () =>
      sortByNextDeadline(
        filterVenues(venues ?? [], { sub, query, showPassed, now }),
        now,
      ),
    [venues, sub, query, showPassed, now],
  );

  if (!open) return null;
  return (
    <div data-testid="deadlines-view" className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <Button variant="ghost" size="sm" onClick={close} data-testid="deadlines-back">
          <ArrowLeft className="size-4" /> Back
        </Button>
        <div className="font-medium">Conference deadlines</div>
        {generatedAt && (
          <span className="text-xs text-muted-foreground">Data: {generatedAt}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {error && <span className="max-w-64 truncate text-xs text-destructive">{error}</span>}
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            data-testid="deadlines-refresh"
            onClick={() => void refresh()}
          >
            <RefreshCw className="size-4" /> {busy ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
        <Button
          size="xs"
          variant={sub === null ? "secondary" : "ghost"}
          onClick={() => setSub(null)}
        >
          All
        </Button>
        {subs.map((s) => (
          <Button
            key={s}
            size="xs"
            variant={sub === s ? "secondary" : "ghost"}
            data-testid={`deadlines-sub-${s}`}
            onClick={() => setSub(sub === s ? null : s)}
          >
            {s}
          </Button>
        ))}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search conferences"
          className="ml-2 h-7 max-w-56 text-xs"
          data-testid="deadlines-search"
        />
        <Button
          size="xs"
          variant={showPassed ? "secondary" : "ghost"}
          className="ml-auto"
          onClick={() => setShowPassed((v) => !v)}
        >
          Show passed
        </Button>
        <span className="text-xs text-muted-foreground">{shown.length} entries</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {venues === null ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : shown.length === 0 ? (
          <div className="text-sm text-muted-foreground">No conferences match.</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((v) => (
              <div
                key={v.id}
                data-testid={`deadline-card-${v.id}`}
                className="flex flex-col gap-1.5 rounded-md border bg-muted/10 p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{v.title}</span>
                  {v.rank && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      {v.rank}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                    {v.sub}
                  </span>
                </div>
                <div className="truncate text-xs text-muted-foreground">{v.full_name}</div>
                <CountdownText venue={v} now={now} />
                <div className="text-[11px] text-muted-foreground">
                  {v.conf_date}
                  {v.place ? ` · ${v.place}` : ""}
                </div>
                {v.link && (
                  <button
                    type="button"
                    className="flex items-center gap-1 self-start text-[11px] text-primary hover:underline"
                    onClick={() => void openExternal(v.link)}
                  >
                    official call <ExternalLink className="size-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
