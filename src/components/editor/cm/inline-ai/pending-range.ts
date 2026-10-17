import type { ChangeDesc } from "@codemirror/state";

export interface PendingRange {
  from: number;
  to: number;
}

export function mapPendingRange(changes: ChangeDesc, range: PendingRange): PendingRange {
  const from = changes.mapPos(range.from, 1);
  const to = changes.mapPos(range.to, -1);
  return to < from ? { from: to, to } : { from, to };
}

export function changeTouchesRange(changes: ChangeDesc, range: PendingRange): boolean {
  let touched = false;
  changes.iterChangedRanges((fromA, toA) => {
    if (fromA === toA ? fromA > range.from && fromA < range.to : fromA < range.to && toA > range.from) {
      touched = true;
    }
  });
  return touched;
}
