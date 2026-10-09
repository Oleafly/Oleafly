import { useLayoutEffect, useRef } from "react";

export function useScrollTopOnChange<T extends HTMLElement = HTMLDivElement>(key: unknown) {
  const ref = useRef<T>(null);
  const lastKey = useRef(key);
  useLayoutEffect(() => {
    if (Object.is(lastKey.current, key)) return;
    lastKey.current = key;
    if (ref.current) ref.current.scrollTop = 0;
  }, [key]);
  return ref;
}
