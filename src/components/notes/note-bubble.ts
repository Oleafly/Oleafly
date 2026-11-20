import { type BoxSize, placeAboveSelection } from "@/components/ui/selection-placement";

export interface SelectionBubble {
  top: number;
  left: number;
}

export interface BubbleAnchor {
  start: { top: number; left: number };
  end: { bottom: number };
}

const FALLBACK_BOX: BoxSize = { width: 200, height: 32 };
const BUBBLE_GAP = 8;

export function bubblePlace(anchor: BubbleAnchor, viewport: { width: number }, box: BoxSize = FALLBACK_BOX): SelectionBubble {
  return placeAboveSelection(
    { top: anchor.start.top, bottom: anchor.end.bottom, left: anchor.start.left },
    { top: BUBBLE_GAP, left: BUBBLE_GAP, right: viewport.width - BUBBLE_GAP, bottom: Number.POSITIVE_INFINITY },
    { width: box.width || FALLBACK_BOX.width, height: box.height || FALLBACK_BOX.height },
    BUBBLE_GAP,
  );
}
