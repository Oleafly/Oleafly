import { MIN_WEIGHT, type DropZone } from "./layout";
import type { Edge } from "./tree";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const EDGE = 0.25;
export const KEY_STEP = 0.02;
export const BIG_KEY_STEP = 0.1;
export const MIN_ROW_PX = 160;
export const MIN_COLUMN_PX = 120;
export const BAR_PX = 36;
export const GAP_BAND_PX = 8;

export function relativeRect(element: Element, origin: DOMRect): Rect {
  const box = element.getBoundingClientRect();
  return { left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height };
}

export function sameRects(left: Record<string, Rect>, right: Record<string, Rect>): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => {
    const a = left[key];
    const b = right[key];
    return a.left === b?.left && a.top === b.top && a.width === b.width && a.height === b.height;
  });
}

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
}

export function nearestEdge(rect: Rect, x: number, y: number, relative = true): [Edge, number] {
  const across = relative ? rect.width : 1;
  const down = relative ? rect.height : 1;
  const left: [Edge, number] = ["left", (x - rect.left) / across];
  const others: [Edge, number][] = [
    ["right", (rect.left + rect.width - x) / across],
    ["top", (y - rect.top) / down],
    ["bottom", (rect.top + rect.height - y) / down],
  ];
  return others.reduce((best, edge) => (edge[1] < best[1] ? edge : best), left);
}

export function slotAlong(rects: readonly Rect[], position: number, axis: "x" | "y"): number {
  return rects.filter((rect) => (axis === "x" ? position >= rect.left + rect.width / 2 : position >= rect.top + rect.height / 2)).length;
}

export function zoneAt(rect: Rect, x: number, y: number, edgeShare = EDGE): DropZone {
  const [zone, distance] = nearestEdge(rect, x, y);
  return distance < edgeShare ? zone : "center";
}

export function zoneRect(rect: Rect, zone: DropZone, share = 0.5): Rect {
  const { left, top, width, height } = rect;
  if (zone === "left") return { left, top, width: width * share, height };
  if (zone === "right") return { left: left + width * (1 - share), top, width: width * share, height };
  if (zone === "top") return { left, top, width, height: height * share };
  if (zone === "bottom") return { left, top: top + height * (1 - share), width, height: height * share };
  return rect;
}

export interface PairShift {
  weights: readonly number[];
  first: number;
  second: number;
  delta: number;
  size: number;
  total: number;
  minFirst: number;
  minSecond: number;
}

export function shiftPair({ weights, first, second, delta, size, total, minFirst, minSecond }: PairShift): number[] | null {
  const pair = weights[first] + weights[second];
  const floor = (pixels: number) => Math.max(MIN_WEIGHT, size > 0 ? pixels / size : 0) * total;
  const lowest = floor(minFirst);
  const highest = pair - floor(minSecond);
  if (lowest >= highest) return null;
  const next = [...weights];
  next[first] = Math.min(highest, Math.max(lowest, weights[first] + delta * total));
  next[second] = pair - next[first];
  return next;
}

export function childrenWith(parent: Element, attribute: string): HTMLElement[] {
  return [...parent.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute(attribute));
}

export function badgeShown(badge: number | string | boolean | undefined): boolean {
  return badge !== undefined && badge !== false && badge !== 0 && badge !== "";
}
