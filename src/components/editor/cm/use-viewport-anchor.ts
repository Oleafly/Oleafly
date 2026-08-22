import { useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { subscribeEditorDocument } from "@oleafly/editor";
import type { ViewportAnchor } from "@/lib/outline-active";

/**
 * Reads the document position at the vertical middle of the editor viewport.
 *
 * The middle, not the top: a heading scrolled just off the top edge is still
 * what you are reading, and an anchor at the top edge would hand the highlight
 * to the next section the instant its title appeared at the bottom of the
 * screen. `precise: false` clips to the nearest position instead of returning
 * null for coordinates that land in the gutter or past the last line.
 */
function readAnchor(view: EditorView, path: string): ViewportAnchor | null {
  const rect = view.scrollDOM.getBoundingClientRect();
  if (rect.height === 0) return null;
  const pos = view.posAtCoords(
    { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    false,
  );
  return { path, pos };
}

/**
 * Tracks where the source editor is scrolled to, so panels outside CodeMirror
 * can follow along.
 *
 * Scroll events fire far faster than anything downstream can usefully repaint,
 * so each burst is collapsed into one measurement per animation frame. Returns
 * null whenever there is no source editor — Visual mode is a different scroll
 * surface, and reporting a stale position for it would point the outline
 * somewhere the reader is not.
 */
export function useEditorViewportAnchor(): ViewportAnchor | null {
  const [anchor, setAnchor] = useState<ViewportAnchor | null>(null);

  useEffect(() => {
    let detachScroll: (() => void) | null = null;

    const unsubscribe = subscribeEditorDocument((path, view) => {
      detachScroll?.();
      detachScroll = null;
      if (!view || !path) {
        setAnchor(null);
        return;
      }

      let frame = 0;
      const measure = () => {
        frame = 0;
        setAnchor(readAnchor(view, path));
      };
      const onScroll = () => {
        if (frame === 0) frame = requestAnimationFrame(measure);
      };

      const scroller = view.scrollDOM;
      scroller.addEventListener("scroll", onScroll, { passive: true });
      // The document just changed; place the highlight before the first scroll.
      // A frame of delay lets CodeMirror finish laying the new document out.
      frame = requestAnimationFrame(measure);

      detachScroll = () => {
        scroller.removeEventListener("scroll", onScroll);
        if (frame !== 0) cancelAnimationFrame(frame);
      };
    });

    return () => {
      unsubscribe();
      detachScroll?.();
    };
  }, []);

  return anchor;
}
