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

export type Overlap<T> = "ours" | "theirs" | "none" | ((ours: T[], theirs: T[], base: T[]) => T[] | null);

function settleOverlap<T>(overlap: Overlap<T>, ours: T[], theirs: T[], base: T[]): T[] | null {
  if (overlap === "none") return null;
  if (overlap === "ours") return ours;
  if (overlap === "theirs") return theirs;
  return overlap(ours, theirs, base);
}

export function mergeSequences<T>(
  base: readonly T[],
  ours: readonly T[],
  theirs: readonly T[],
  key: (item: T) => string,
  sources?: MergeSources,
): T[] {
  return mergeOrRefuse(base, ours, theirs, key, "theirs", sources) ?? [...theirs];
}

interface ChangeGroup {
  from: number;
  to: number;
  ourGrowth: number;
  theirGrowth: number;
  oursTouch: boolean;
  theirsTouch: boolean;
  next: number;
}

function changeGroupAt(all: readonly SidedChange[], start: number): ChangeGroup {
  const first = all[start];
  const group: ChangeGroup = { from: first.from, to: first.to, ourGrowth: 0, theirGrowth: 0, oursTouch: false, theirsTouch: false, next: start };
  const joins = (change: SidedChange) =>
    change.from < group.to || (change.from === group.from && change.to === group.from && group.to === group.from);
  while (group.next < all.length && (all[group.next] === first || joins(all[group.next]))) {
    const change = all[group.next];
    group.to = Math.max(group.to, change.to);
    if (change.ours) {
      group.ourGrowth += growth(change);
      group.oursTouch = true;
    } else {
      group.theirGrowth += growth(change);
      group.theirsTouch = true;
    }
    group.next += 1;
  }
  return group;
}

interface MergeInput<T> {
  base: readonly T[];
  ours: readonly T[];
  theirs: readonly T[];
  key: (item: T) => string;
  overlap: Overlap<T>;
}

function groupItems<T>(input: MergeInput<T>, group: ChangeGroup, ourShift: number, theirShift: number): T[] | null {
  const { from, to, oursTouch, theirsTouch } = group;
  const ourPart = input.ours.slice(from + ourShift, to + ourShift + group.ourGrowth);
  const theirPart = input.theirs.slice(from + theirShift, to + theirShift + group.theirGrowth);
  if (oursTouch && theirsTouch && from === to) return [...ourPart, ...theirPart];
  if (!oursTouch || !theirsTouch || sameKeys(ourPart.map(input.key), theirPart.map(input.key))) return theirsTouch ? theirPart : ourPart;
  return settleOverlap(input.overlap, ourPart, theirPart, input.base.slice(from, to));
}

export function mergeOrRefuse<T>(
  base: readonly T[],
  ours: readonly T[],
  theirs: readonly T[],
  key: (item: T) => string,
  overlap: Overlap<T>,
  sources?: MergeSources,
): T[] | null {
  const baseKeys = base.map(key);
  const ourKeys = ours.map(key);
  if (sameKeys(ourKeys, baseKeys)) return [...theirs];
  const baseSourced = withSource(baseKeys, sources?.base);
  const theirSourced = withSource(theirs.map(key), sources?.theirs);
  if (sameKeys(theirSourced, baseSourced)) return [...ours];
  const mine = ourKeys.length === baseKeys.length ? inPlaceChanges(baseKeys, ourKeys) : changesBetween(baseKeys, ourKeys);
  const their = changesBetween(baseSourced, theirSourced);
  if (!mine || !their) return null;
  const all: SidedChange[] = [
    ...mine.map((change) => ({ ...change, ours: true })),
    ...their.map((change) => ({ ...change, ours: false })),
  ].sort((left, right) => left.from - right.from || left.to - right.to);
  const input: MergeInput<T> = { base, ours, theirs, key, overlap };
  const merged: T[] = [];
  let cursor = 0;
  let ourShift = 0;
  let theirShift = 0;
  let index = 0;
  while (index < all.length) {
    const group = changeGroupAt(all, index);
    for (let at = cursor; at < group.from; at += 1) merged.push(ours[at + ourShift]);
    const items = groupItems(input, group, ourShift, theirShift);
    if (!items) return null;
    merged.push(...items);
    ourShift += group.ourGrowth;
    theirShift += group.theirGrowth;
    cursor = group.to;
    index = group.next;
  }
  for (let at = cursor; at < base.length; at += 1) merged.push(ours[at + ourShift]);
  return merged;
}
