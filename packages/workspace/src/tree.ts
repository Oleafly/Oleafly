export type Direction = "row" | "column";
export type Edge = "left" | "right" | "top" | "bottom";

export interface Siblings<T> {
  children: T[];
  weights: number[];
}

export function edgeDirection(edge: Edge): Direction {
  return edge === "left" || edge === "right" ? "row" : "column";
}

export function isLeadingEdge(edge: Edge): boolean {
  return edge === "left" || edge === "top";
}

export function normalWeights(weights: readonly (number | undefined)[], count: number): number[] {
  const usable = Array.from({ length: count }, (_, index) => {
    const value = weights[index];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
  });
  const total = usable.reduce((sum, value) => sum + value, 0);
  return usable.map((value) => value / total);
}

export function reorder<T>(values: readonly T[], from: number, to: number): T[] {
  const next = [...values];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function spliceBeside<T>(
  children: readonly T[],
  weights: readonly number[],
  index: number,
  added: T,
  edge: Edge,
  share: number,
): Siblings<T> {
  const weight = weights[index] ?? 0;
  const nextChildren = [...children];
  const nextWeights = [...weights];
  nextWeights.splice(index, 1, weight * (1 - share));
  const at = isLeadingEdge(edge) ? index : index + 1;
  nextChildren.splice(at, 0, added);
  nextWeights.splice(at, 0, weight * share);
  return { children: nextChildren, weights: nextWeights };
}

export function pairBeside<T>(target: T, added: T, edge: Edge, share: number): Siblings<T> {
  return isLeadingEdge(edge)
    ? { children: [added, target], weights: [share, 1 - share] }
    : { children: [target, added], weights: [1 - share, share] };
}
