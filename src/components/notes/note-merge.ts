import { commonAffixBounds, myersEditScript } from "@/lib/myers-diff";

interface Change {
  from: number;
  to: number;
  start: number;
  end: number;
}

interface SidedChange extends Change {
  ours: boolean;
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function inPlaceChanges(base: readonly string[], other: readonly string[]): Change[] {
  const changes: Change[] = [];
  let open: Change | null = null;
  for (let index = 0; index < base.length; index += 1) {
    if (base[index] === other[index]) {
      open = null;
    } else if (open) {
      open.to = index + 1;
      open.end = index + 1;
    } else {
      open = { from: index, to: index + 1, start: index, end: index + 1 };
      changes.push(open);
    }
  }
  return changes;
}

function changesBetween(base: readonly string[], other: readonly string[]): Change[] | null {
  const { prefix: head, oldEnd, newEnd } = commonAffixBounds(base, other);
  const script = myersEditScript(base.slice(head, oldEnd), other.slice(head, newEnd));
  if (!script) return null;
  const changes: Change[] = [];
  let open: Change | null = null;
  let oldAt = head;
  let newAt = head;
  for (const raw of script) {
    const edit = { ...raw, oldStart: raw.oldStart + head, newStart: raw.newStart + head };
    if (edit.kind === "same") {
      open = null;
      oldAt = edit.oldStart + edit.length;
      newAt = edit.newStart + edit.length;
      continue;
    }
    if (!open) {
      open = { from: oldAt, to: oldAt, start: newAt, end: newAt };
      changes.push(open);
    }
    if (edit.kind === "del") {
      open.to = edit.oldStart + edit.length;
      oldAt = open.to;
    } else {
      open.end = edit.newStart + edit.length;
      newAt = open.end;
    }
  }
  return changes;
}

const growth = (change: Change) => change.end - change.start - (change.to - change.from);

export interface MergeSources {
  base: readonly string[];
  theirs: readonly string[];
}

function withSource(keys: readonly string[], sources: readonly string[] | undefined): string[] {
  return sources ? keys.map((key, index) => `${key}\u0001${sources[index] ?? ""}`) : [...keys];
}

export function mergeSequences<T>(
  base: readonly T[],
  ours: readonly T[],
  theirs: readonly T[],
  key: (item: T) => string,
  sources?: MergeSources,
): T[] {
  const baseKeys = base.map(key);
  const ourKeys = ours.map(key);
  if (sameKeys(ourKeys, baseKeys)) return [...theirs];
  const baseSourced = withSource(baseKeys, sources?.base);
  const theirSourced = withSource(theirs.map(key), sources?.theirs);
  if (sameKeys(theirSourced, baseSourced)) return [...ours];
  const mine = ourKeys.length === baseKeys.length ? inPlaceChanges(baseKeys, ourKeys) : changesBetween(baseKeys, ourKeys);
  const their = changesBetween(baseSourced, theirSourced);
  if (!mine || !their) return [...theirs];
  const all: SidedChange[] = [
    ...mine.map((change) => ({ ...change, ours: true })),
    ...their.map((change) => ({ ...change, ours: false })),
  ].sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: T[] = [];
  let cursor = 0;
  let ourShift = 0;
  let theirShift = 0;
  let index = 0;
  while (index < all.length) {
    const first = all[index];
    const from = first.from;
    let to = first.to;
    let ourGrowth = 0;
    let theirGrowth = 0;
    let oursTouch = false;
    let theirsTouch = false;
    const joins = (change: SidedChange) =>
      change.from < to || (change.from === from && change.to === from && to === from);
    while (index < all.length && (all[index] === first || joins(all[index]))) {
      const change = all[index];
      to = Math.max(to, change.to);
      if (change.ours) {
        ourGrowth += growth(change);
        oursTouch = true;
      } else {
        theirGrowth += growth(change);
        theirsTouch = true;
      }
      index += 1;
    }
    for (let at = cursor; at < from; at += 1) merged.push(ours[at + ourShift]);
    const ourPart = ours.slice(from + ourShift, to + ourShift + ourGrowth);
    const theirPart = theirs.slice(from + theirShift, to + theirShift + theirGrowth);
    if (oursTouch && theirsTouch && from === to) merged.push(...ourPart, ...theirPart);
    else merged.push(...(theirsTouch ? theirPart : ourPart));
    ourShift += ourGrowth;
    theirShift += theirGrowth;
    cursor = to;
  }
  for (let at = cursor; at < base.length; at += 1) merged.push(ours[at + ourShift]);
  return merged;
}
