import { useCallback, useState } from "react";

export function orderSections(saved: readonly string[] | null, ids: readonly string[]): string[] {
  const known = new Set(ids);
  const kept = (saved ?? []).filter((id, index, list) => known.has(id) && list.indexOf(id) === index);
  return [...kept, ...ids.filter((id) => !kept.includes(id))];
}

export function moveSection(order: readonly string[], id: string, to: number): string[] {
  if (!order.includes(id)) return [...order];
  const next = order.filter((item) => item !== id);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, id);
  return next;
}

function readOrder(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : null;
  } catch {
    return null;
  }
}

export function useSectionOrder(key: string, ids: readonly string[]): readonly [string[], (next: readonly string[]) => void] {
  const [saved, setSaved] = useState(() => readOrder(key));
  const reorder = useCallback(
    (next: readonly string[]) => {
      setSaved([...next]);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        return;
      }
    },
    [key],
  );
  return [orderSections(saved, ids), reorder] as const;
}
