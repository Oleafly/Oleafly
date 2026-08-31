import {
  useCallback,
  useLayoutEffect,
  useRef,
  type Ref,
} from "react";

// A native (OS-level) webview always paints above the host page's DOM, so a
// DOM overlay that sits on top of it cannot occlude it. The workaround is to
// hide the native webview while an overlay covers it. To avoid hiding it for
// an overlay that does not actually touch it (a tooltip in the far corner,
// say), each occluder registers a rect getter and the native surface hides
// only when an occluder's rect intersects its own. An occluder with no known
// geometry (a full-screen modal backdrop) is treated as always overlapping.

type RectGetter = () => DOMRect | null;

const occluders = new Map<symbol, RectGetter>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function acquireNativeWebviewOcclusion(getRect?: RectGetter): () => void {
  const id = Symbol();
  occluders.set(id, getRect ?? (() => null));
  notify();
  return () => {
    if (occluders.delete(id)) notify();
  };
}

function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Whether any active occluder overlaps `target`. A null target, or an occluder
 * that reports no rect (unknown or full-screen), counts as an overlap so a
 * genuine modal still hides the native surface.
 */
export function nativeWebviewOccludedBy(target: DOMRect | null): boolean {
  if (occluders.size === 0) return false;
  if (!target) return true;
  for (const getRect of occluders.values()) {
    const rect = getRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      if (!rect) return true;
      continue;
    }
    if (rectsIntersect(rect, target)) return true;
  }
  return false;
}

/** Whether any occluder is currently registered, ignoring geometry. */
export function getNativeWebviewOccluded(): boolean {
  return occluders.size > 0;
}

export function subscribeToNativeWebviewOcclusion(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOccludeNativeWebview(active: boolean, getRect?: RectGetter) {
  const getRectRef = useRef(getRect);
  getRectRef.current = getRect;
  useLayoutEffect(() => {
    if (!active) return;
    // Defer to the live ref so a moving overlay reports its current rect.
    return acquireNativeWebviewOcclusion(() => getRectRef.current?.() ?? null);
  }, [active]);
}

export function useNativeWebviewOcclusionRef<T extends HTMLElement>(
  forwardedRef: Ref<T>,
) {
  const releaseRef = useRef<(() => void) | null>(null);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const EXIT_OCCLUSION_MS = 250;
  const setRef = useCallback(
    (node: T | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
      releaseRef.current?.();
      releaseRef.current = null;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
      if (!node) return;
      const update = () => {
        if (node.dataset.state === "open") {
          if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
          releaseTimerRef.current = null;
          releaseRef.current ??= acquireNativeWebviewOcclusion(() =>
            node.getBoundingClientRect(),
          );
        } else if (releaseRef.current && !releaseTimerRef.current) {
          releaseTimerRef.current = setTimeout(() => {
            releaseTimerRef.current = null;
            releaseRef.current?.();
            releaseRef.current = null;
          }, EXIT_OCCLUSION_MS);
        }
      };
      update();
      observerRef.current = new MutationObserver(update);
      observerRef.current.observe(node, {
        attributes: true,
        attributeFilter: ["data-state"],
      });
    },
    [forwardedRef],
  );
  useLayoutEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
      releaseRef.current?.();
      releaseRef.current = null;
    },
    [],
  );
  return setRef;
}
