import { useCallback, useRef, useState } from "react";
import { readJson, removeKey, writeJson } from "@/lib/local-storage";

export type OrderMerge = (saved: readonly string[] | null, ids: readonly string[]) => string[];

function parseOrder(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id !== ""))];
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function usePersistedOrder(
  key: string,
  ids: readonly string[],
  merge: OrderMerge,
): readonly [string[], (next: readonly string[]) => void] {
  const [saved, setSaved] = useState(() => readJson<string[] | null>(key, null, parseOrder));
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const reorder = useCallback(
    (next: readonly string[]) => {
      const merged = merge(next, idsRef.current);
      setSaved(merged);
      if (sameOrder(merged, merge(null, idsRef.current))) removeKey(key);
      else writeJson(key, merged);
    },
    [key, merge],
  );
  return [merge(saved, ids), reorder] as const;
}
