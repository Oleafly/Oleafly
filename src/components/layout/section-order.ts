import { usePersistedOrder } from "./persisted-order";

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

export function useSectionOrder(key: string, ids: readonly string[]): readonly [string[], (next: readonly string[]) => void] {
  return usePersistedOrder(key, ids, orderSections);
}
