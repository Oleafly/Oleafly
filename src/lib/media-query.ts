import { useEffect, useState } from "react";

export function mediaQuery(query: string): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
}

export function useMediaQuery(query: string, fallback = false): boolean {
  const [matches, setMatches] = useState(() => mediaQuery(query)?.matches ?? fallback);
  useEffect(() => {
    const list = mediaQuery(query);
    if (!list) return;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}
