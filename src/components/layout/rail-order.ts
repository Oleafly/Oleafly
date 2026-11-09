import { usePersistedOrder } from "./persisted-order";

export const RAIL_ORDER_KEY = "oleafly.sidebar.railOrder";

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

export function useRailOrder(registered: readonly string[]): readonly [string[], (next: readonly string[]) => void] {
  return usePersistedOrder(RAIL_ORDER_KEY, registered, mergeRailOrder);
}
