import { useState, useSyncExternalStore } from "react";
import type { EditorView } from "@codemirror/view";
import { subscribeEditorDocument } from "@oleafly/editor";
import type { ViewportAnchor } from "@/lib/outline-active";

function readAnchor(view: EditorView, path: string): ViewportAnchor | null {
  const rect = view.scrollDOM.getBoundingClientRect();
  if (rect.height === 0) return null;
  const pos = view.posAtCoords(
    { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    false,
  );
  return { path, pos };
}

export function useEditorViewportAnchor(): ViewportAnchor | null {
  return useEditorViewportSelection(identity);
}

function identity(anchor: ViewportAnchor | null): ViewportAnchor | null {
  return anchor;
}

export function useEditorViewportSelection<T>(select: (anchor: ViewportAnchor | null) => T): T {
  const [source] = useState(createViewportAnchorSource);
  return useSyncExternalStore(
    source.subscribe,
    () => select(source.get()),
    () => select(null),
  );
}

interface ViewportAnchorSource {
  get(): ViewportAnchor | null;
  subscribe(listener: () => void): () => void;
}

function createViewportAnchorSource(): ViewportAnchorSource {
  let anchor: ViewportAnchor | null = null;
  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | null = null;
  let detachScroll: (() => void) | null = null;

  const publish = (next: ViewportAnchor | null) => {
    const value =
      next && anchor?.path === next.path && anchor.pos === next.pos ? anchor : next;
    if (value === anchor) return;
    anchor = value;
    for (const listener of listeners) listener();
  };

  const start = () => {
    unsubscribe = subscribeEditorDocument((path, view) => {
      detachScroll?.();
      detachScroll = null;
      if (!view || !path) {
        publish(null);
        return;
      }

      let frame = 0;
      const measure = () => {
        frame = 0;
        publish(readAnchor(view, path));
      };
      const onScroll = () => {
        if (frame === 0) frame = requestAnimationFrame(measure);
      };

      const scroller = view.scrollDOM;
      scroller.addEventListener("scroll", onScroll, { passive: true });
      frame = requestAnimationFrame(measure);

      detachScroll = () => {
        scroller.removeEventListener("scroll", onScroll);
        if (frame !== 0) cancelAnimationFrame(frame);
      };
    });
  };

  const stop = () => {
    unsubscribe?.();
    unsubscribe = null;
    detachScroll?.();
    detachScroll = null;
  };

  return {
    get: () => anchor,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
  };
}
