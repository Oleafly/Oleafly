import { useState } from "react";

const states = new Map<string, boolean>();
const LIMIT = 2_000;

function remember(key: string, value: boolean) {
  states.delete(key);
  states.set(key, value);
  if (states.size > LIMIT) {
    const oldest = states.keys().next().value;
    if (oldest) states.delete(oldest);
  }
}

export function usePersistentExpansion(key: string | undefined, initial = false) {
  const [local, setLocal] = useState(() => key ? (states.get(key) ?? initial) : initial);
  const setExpanded = (value: boolean | ((current: boolean) => boolean)) => {
    setLocal((current) => {
      const next = typeof value === "function" ? value(current) : value;
      if (key) remember(key, next);
      return next;
    });
  };
  return [local, setExpanded] as const;
}

export function clearExpansionState() {
  states.clear();
}
