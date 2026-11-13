export function promoteShown(
  recent: readonly string[],
  shown: readonly string[],
  known: Readonly<Record<string, unknown>>,
): readonly string[] {
  const front = new Set(shown);
  const next = [...shown, ...recent.filter((id) => !front.has(id) && Object.hasOwn(known, id))];
  return next.length === recent.length && next.every((id, index) => id === recent[index]) ? recent : next;
}

export function keptViews(
  recent: readonly string[],
  shown: ReadonlySet<string>,
  limit: number,
  canRelease?: (id: string) => boolean,
): Set<string> {
  const kept = new Set(shown);
  let hidden = 0;
  for (const id of recent) {
    if (shown.has(id)) continue;
    if (canRelease && !canRelease(id)) kept.add(id);
    else if (hidden < limit) {
      kept.add(id);
      hidden += 1;
    }
  }
  return kept;
}
