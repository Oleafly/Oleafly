import { useEffect, useRef, type RefObject } from "react";

export function useInitialFocus<T extends HTMLElement>(active = true): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (active) ref.current?.focus();
  }, [active]);

  return ref;
}
