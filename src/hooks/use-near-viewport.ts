import { useEffect, useState } from "react";

export const NEAR_VIEWPORT_MARGIN = "200px";

type Watcher = (visible: boolean) => void;

interface WatchGroup {
  type: typeof IntersectionObserver;
  observer: IntersectionObserver;
  watchers: Map<Element, Watcher>;
}

const groups = new Map<string, WatchGroup>();

function groupFor(margin: string): WatchGroup {
  const current = groups.get(margin);
  if (current?.type === IntersectionObserver) return current;
  const watchers = new Map<Element, Watcher>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) watchers.get(entry.target)?.(entry.isIntersecting);
    },
    { rootMargin: margin },
  );
  const group = { type: IntersectionObserver, observer, watchers };
  groups.set(margin, group);
  return group;
}

function unwatch(group: WatchGroup, margin: string, element: Element, watcher: Watcher): void {
  if (group.watchers.get(element) !== watcher) return;
  group.watchers.delete(element);
  group.observer.unobserve(element);
  if (group.watchers.size > 0) return;
  group.observer.disconnect();
  if (groups.get(margin) === group) groups.delete(margin);
}

export function watchVisibility(element: Element, onChange: Watcher, margin = NEAR_VIEWPORT_MARGIN): () => void {
  if (typeof IntersectionObserver === "undefined") {
    onChange(true);
    return () => {};
  }
  const group = groupFor(margin);
  group.watchers.set(element, onChange);
  group.observer.observe(element);
  return () => unwatch(group, margin, element, onChange);
}

export function whenNearViewport(element: Element, onNear: () => void, margin = NEAR_VIEWPORT_MARGIN): () => void {
  let stop: (() => void) | null = null;
  let done = false;
  stop = watchVisibility(
    element,
    (visible) => {
      if (!visible || done) return;
      done = true;
      stop?.();
      onNear();
    },
    margin,
  );
  if (done) stop();
  return () => stop?.();
}

export function useNearViewport<T extends Element>(margin = NEAR_VIEWPORT_MARGIN): [(node: T | null) => void, boolean] {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  const [node, setNode] = useState<T | null>(null);
  useEffect(() => {
    if (near || !node) return;
    return whenNearViewport(node, () => setNear(true), margin);
  }, [margin, near, node]);
  return [setNode, near];
}
