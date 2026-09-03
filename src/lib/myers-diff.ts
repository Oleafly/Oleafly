export const MAX_DIFF_WORK = 2_000_000;

export interface CommonAffixBounds {
  prefix: number;
  oldEnd: number;
  newEnd: number;
}

export type MyersEditKind = "same" | "del" | "add";

export interface MyersEdit {
  kind: MyersEditKind;
  oldStart: number;
  newStart: number;
  length: number;
}

export function commonAffixBounds<T>(
  oldItems: readonly T[],
  newItems: readonly T[],
): CommonAffixBounds {
  let prefix = 0;
  while (
    prefix < oldItems.length &&
    prefix < newItems.length &&
    oldItems[prefix] === newItems[prefix]
  ) {
    prefix += 1;
  }
  let oldEnd = oldItems.length;
  let newEnd = newItems.length;
  while (oldEnd > prefix && newEnd > prefix && oldItems[oldEnd - 1] === newItems[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  return { prefix, oldEnd, newEnd };
}

export function myersEditDistance<T>(
  oldItems: readonly T[],
  newItems: readonly T[],
  workLimit: number = MAX_DIFF_WORK,
): number | null {
  const oldCount = oldItems.length;
  const newCount = newItems.length;
  if (oldCount === 0) return newCount;
  if (newCount === 0) return oldCount;

  const max = oldCount + newCount;
  const offset = max + 1;
  const frontier = new Int32Array(max * 2 + 3);
  frontier.fill(-1);
  frontier[offset + 1] = 0;
  let work = 0;

  for (let distance = 0; distance <= max; distance += 1) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      work += 1;
      if (work > workLimit) return null;
      const index = offset + diagonal;
      let oldIndex =
        diagonal === -distance ||
        (diagonal !== distance && frontier[index - 1] < frontier[index + 1])
          ? frontier[index + 1]
          : frontier[index - 1] + 1;
      let newIndex = oldIndex - diagonal;
      while (
        oldIndex < oldCount &&
        newIndex < newCount &&
        oldItems[oldIndex] === newItems[newIndex]
      ) {
        oldIndex += 1;
        newIndex += 1;
      }
      frontier[index] = oldIndex;
      if (oldIndex >= oldCount && newIndex >= newCount) return distance;
    }
  }

  return null;
}

export function myersEditScript<T>(
  oldItems: readonly T[],
  newItems: readonly T[],
  workLimit: number = MAX_DIFF_WORK,
): MyersEdit[] | null {
  const oldCount = oldItems.length;
  const newCount = newItems.length;
  if (oldCount === 0 && newCount === 0) return [];
  if (oldCount === 0) return [{ kind: "add", oldStart: 0, newStart: 0, length: newCount }];
  if (newCount === 0) return [{ kind: "del", oldStart: 0, newStart: 0, length: oldCount }];

  const max = oldCount + newCount;
  const offset = max + 1;
  const frontier = new Int32Array(max * 2 + 3);
  frontier.fill(-1);
  frontier[offset + 1] = 0;
  const trace: Int32Array[] = [];
  let work = 0;

  for (let distance = 0; distance <= max; distance += 1) {
    trace.push(frontier.slice(offset - distance - 1, offset + distance + 2));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      work += 1;
      if (work > workLimit) return null;
      const index = offset + diagonal;
      let oldIndex =
        diagonal === -distance ||
        (diagonal !== distance && frontier[index - 1] < frontier[index + 1])
          ? frontier[index + 1]
          : frontier[index - 1] + 1;
      let newIndex = oldIndex - diagonal;
      while (
        oldIndex < oldCount &&
        newIndex < newCount &&
        oldItems[oldIndex] === newItems[newIndex]
      ) {
        oldIndex += 1;
        newIndex += 1;
      }
      frontier[index] = oldIndex;
      if (oldIndex >= oldCount && newIndex >= newCount) {
        return backtrack(trace, oldCount, newCount);
      }
    }
  }

  return null;
}

function backtrack(trace: Int32Array[], oldCount: number, newCount: number): MyersEdit[] {
  const steps: MyersEdit[] = [];
  let oldIndex = oldCount;
  let newIndex = newCount;

  for (let distance = trace.length - 1; distance >= 0; distance -= 1) {
    const snapshot = trace[distance];
    const base = distance + 1;
    const diagonal = oldIndex - newIndex;
    const previousDiagonal =
      diagonal === -distance ||
      (diagonal !== distance && snapshot[base + diagonal - 1] < snapshot[base + diagonal + 1])
        ? diagonal + 1
        : diagonal - 1;
    const previousOld = snapshot[base + previousDiagonal];
    const previousNew = previousOld - previousDiagonal;

    while (oldIndex > previousOld && newIndex > previousNew) {
      oldIndex -= 1;
      newIndex -= 1;
      steps.push({ kind: "same", oldStart: oldIndex, newStart: newIndex, length: 1 });
    }
    if (distance === 0) break;
    if (oldIndex === previousOld) {
      newIndex -= 1;
      steps.push({ kind: "add", oldStart: oldIndex, newStart: newIndex, length: 1 });
    } else {
      oldIndex -= 1;
      steps.push({ kind: "del", oldStart: oldIndex, newStart: newIndex, length: 1 });
    }
  }

  steps.reverse();

  const merged: MyersEdit[] = [];
  for (const step of steps) {
    const last = merged[merged.length - 1];
    if (last && last.kind === step.kind) last.length += step.length;
    else merged.push(step);
  }
  return merged;
}
