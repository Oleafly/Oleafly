import { useEffect, useState } from "react";

export function useDebouncedValue<T>(
  value: T,
  delayMs: number,
  skipDelay?: (value: T) => boolean,
): T {
  const [settled, setSettled] = useState(value);
  const immediate = skipDelay?.(value) ?? false;

  useEffect(() => {
    if (immediate) {
      setSettled(value);
      return;
    }
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs, immediate]);

  return immediate ? value : settled;
}
