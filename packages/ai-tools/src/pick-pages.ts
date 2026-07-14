// Pure helper for which PDF pages an agent should inspect after compile.

export function pickPagesToVerify(
  numPages: number,
  opts: { cursorPage?: number; maxPages?: number } = {},
): number[] {
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 4, 8));
  if (numPages < 1) return [];
  if (numPages === 1) return [1];

  const set = new Set<number>();
  set.add(1);
  set.add(numPages);

  const cursor = opts.cursorPage;
  if (cursor != null && cursor >= 1 && cursor <= numPages) set.add(cursor);

  let guard = 0;
  while (set.size < maxPages && set.size < numPages && guard++ < 64) {
    const step = Math.max(1, Math.floor(numPages / (maxPages + 1)));
    for (let p = 1 + step; p < numPages && set.size < maxPages; p += step) {
      set.add(p);
    }
    for (let p = 2; p < numPages && set.size < maxPages; p++) set.add(p);
  }

  const all = [...set].sort((a, b) => a - b);
  if (all.length <= maxPages) return all;
  // Over budget (maxPages smaller than the seeded first/last/cursor set): keep
  // the endpoints and take the earliest middles, so first and last always
  // survive the cap rather than being sliced off the tail.
  if (maxPages === 1) return [1];
  const middles = all.filter((p) => p !== 1 && p !== numPages).slice(0, maxPages - 2);
  return [1, ...middles, numPages];
}
