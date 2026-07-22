export interface DeadlineEntry {
  kind: string;
  at: string;
}

export interface Venue {
  id: string;
  title: string;
  full_name: string;
  sub: string;
  rank: string;
  link: string;
  timezone: string;
  deadlines: DeadlineEntry[];
  conf_date: string;
  place: string;
}

/** "yyyy-mm-dd hh:mm:ss" in a "UTC±N" / "AoE" zone to an absolute instant. */
export function deadlineInstant(at: string, timezone: string): Date {
  const m = at.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return new Date(Number.NaN);
  const tz = timezone.trim();
  const offsetHours = tz === "AoE" ? -12 : Number(tz.match(/^UTC([+-]\d+)$/)?.[1] ?? 0);
  const utc = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
  return new Date(utc - offsetHours * 3_600_000);
}

export function nextDeadline(v: Venue, now: Date): { kind: string; when: Date } | null {
  let best: { kind: string; when: Date } | null = null;
  for (const d of v.deadlines) {
    const when = deadlineInstant(d.at, v.timezone);
    if (Number.isNaN(when.getTime()) || when <= now) continue;
    if (!best || when < best.when) best = { kind: d.kind, when };
  }
  return best;
}

export function countdown(
  target: Date,
  now: Date,
): { days: number; hours: number; minutes: number; seconds: number } | null {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return null;
  const seconds = Math.floor(ms / 1000);
  return {
    days: Math.floor(seconds / 86_400),
    hours: Math.floor((seconds % 86_400) / 3_600),
    minutes: Math.floor((seconds % 3_600) / 60),
    seconds: seconds % 60,
  };
}

export function filterVenues(
  venues: Venue[],
  opts: { sub?: string | null; query?: string; showPassed?: boolean; now: Date },
): Venue[] {
  const q = (opts.query ?? "").trim().toLowerCase();
  return venues.filter((v) => {
    if (opts.sub && v.sub !== opts.sub) return false;
    if (q && !v.title.toLowerCase().includes(q) && !v.full_name.toLowerCase().includes(q)) {
      return false;
    }
    if (!opts.showPassed && nextDeadline(v, opts.now) === null) return false;
    return true;
  });
}

export function sortByNextDeadline(venues: Venue[], now: Date): Venue[] {
  return [...venues].sort((a, b) => {
    const na = nextDeadline(a, now);
    const nb = nextDeadline(b, now);
    if (na && nb) return na.when.getTime() - nb.when.getTime();
    if (na) return -1;
    if (nb) return 1;
    return a.title.localeCompare(b.title);
  });
}
