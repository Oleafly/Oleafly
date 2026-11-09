import { useCallback, useRef, useState } from "react";

export const RAIL_ORDER_KEY = "oleafly.sidebar.railOrder";

export function parseRailOrder(raw: string | null): string[] | null {
  let value: unknown = null;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id !== ""))];
}

export function mergeRailOrder(saved: readonly string[] | null, registered: readonly string[]): string[] {
  const known = new Set(registered);
  const order = [...new Set(saved ?? [])].filter((id) => known.has(id));
  registered.forEach((id, index) => {
    if (order.includes(id)) return;
    const before = registered[index - 1];
    order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, id);
  });
  return order;
}

export function applyRailOrder<T extends { id: string }>(tabs: readonly T[], order: readonly string[]): T[] {
  const rank = (tab: T) => {
    const index = order.indexOf(tab.id);
    return index < 0 ? order.length : index;
  };
  return [...tabs].sort((a, b) => rank(a) - rank(b));
}

export function readRailOrder(): string[] | null {
  try {
    return parseRailOrder(localStorage.getItem(RAIL_ORDER_KEY));
  } catch {
    return null;
  }
}

export function writeRailOrder(order: readonly string[], registered: readonly string[]): void {
  const fallback = mergeRailOrder(null, registered);
  const isDefault = order.length === fallback.length && order.every((id, index) => id === fallback[index]);
  try {
    if (isDefault) localStorage.removeItem(RAIL_ORDER_KEY);
    else localStorage.setItem(RAIL_ORDER_KEY, JSON.stringify(order));
  } catch {
    return;
  }
}

export function useRailOrder(registered: readonly string[]): readonly [string[], (next: readonly string[]) => void] {
  const [saved, setSaved] = useState(readRailOrder);
  const registeredRef = useRef(registered);
  registeredRef.current = registered;
  const reorder = useCallback((next: readonly string[]) => {
    const merged = mergeRailOrder(next, registeredRef.current);
    setSaved(merged);
    writeRailOrder(merged, registeredRef.current);
  }, []);
  return [mergeRailOrder(saved, registered), reorder] as const;
}
