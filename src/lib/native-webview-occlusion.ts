import {
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type Ref,
} from "react";

const occluders = new Set<symbol>();
const listeners = new Set<() => void>();
const EXIT_OCCLUSION_MS = 250;

function notifyIfChanged(wasOccluded: boolean) {
  if (wasOccluded === getNativeWebviewOccluded()) return;
  for (const listener of listeners) listener();
}

export function acquireNativeWebviewOcclusion(): () => void {
  const wasOccluded = getNativeWebviewOccluded();
  const id = Symbol();
  occluders.add(id);
  notifyIfChanged(wasOccluded);
  return () => {
    const beforeRelease = getNativeWebviewOccluded();
    if (!occluders.delete(id)) return;
    notifyIfChanged(beforeRelease);
  };
}

export function getNativeWebviewOccluded(): boolean {
  return occluders.size > 0;
}

export function subscribeToNativeWebviewOcclusion(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOccludeNativeWebview(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return;
    return acquireNativeWebviewOcclusion();
  }, [active]);
}

export function useNativeWebviewOccluded(): boolean {
  return useSyncExternalStore(
    subscribeToNativeWebviewOcclusion,
    getNativeWebviewOccluded,
    getNativeWebviewOccluded,
  );
}

export function useNativeWebviewOcclusionRef<T extends HTMLElement>(
  forwardedRef: Ref<T>,
) {
  const releaseRef = useRef<(() => void) | null>(null);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
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
          releaseRef.current ??= acquireNativeWebviewOcclusion();
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
