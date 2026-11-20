const listeners = new Map<Element, Set<() => void>>();
let observer: ResizeObserver | null = null;

export function watchSize(element: Element, onResize: () => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => undefined;
  observer ??= new ResizeObserver((entries) => {
    for (const entry of entries) for (const listener of [...(listeners.get(entry.target) ?? [])]) listener();
  });
  const watching = observer;
  const known = listeners.get(element);
  const own = known ?? new Set<() => void>();
  own.add(onResize);
  if (!known) {
    listeners.set(element, own);
    watching.observe(element);
  }
  return () => {
    own.delete(onResize);
    if (own.size > 0 || listeners.get(element) !== own) return;
    listeners.delete(element);
    watching.unobserve(element);
    if (listeners.size === 0 && observer === watching) {
      watching.disconnect();
      observer = null;
    }
  };
}
