import type { CollabHistoryEntry } from "@/lib/tauri";

export interface HistoryDay {
  key: string;
  at: number | null;
  entries: CollabHistoryEntry[];
}

function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function historyDays(entries: readonly CollabHistoryEntry[]): HistoryDay[] {
  const days: HistoryDay[] = [];
  const earlier: CollabHistoryEntry[] = [];
  for (const entry of entries) {
    if (entry.at <= 0) {
      earlier.push(entry);
      continue;
    }
    const key = dayKey(entry.at);
    const last = days.at(-1);
    if (last?.key === key) last.entries.push(entry);
    else days.push({ key, at: entry.at, entries: [entry] });
  }
  if (earlier.length > 0) days.push({ key: "earlier", at: null, entries: earlier });
  return days;
}

export function mergeHistory(
  current: readonly CollabHistoryEntry[],
  page: readonly CollabHistoryEntry[],
): CollabHistoryEntry[] {
  const known = new Set(current.map((entry) => entry.id));
  return [...current, ...page.filter((entry) => !known.has(entry.id))];
}

export function olderFirst(
  left: CollabHistoryEntry,
  right: CollabHistoryEntry,
  order: readonly CollabHistoryEntry[],
): [CollabHistoryEntry, CollabHistoryEntry] {
  const place = (entry: CollabHistoryEntry) => order.findIndex((listed) => listed.id === entry.id);
  const [leftAt, rightAt] = [place(left), place(right)];
  const leftOlder = leftAt >= 0 && rightAt >= 0 ? leftAt > rightAt : left.at < right.at;
  return leftOlder ? [left, right] : [right, left];
}
