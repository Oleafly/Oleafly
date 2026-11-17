export interface SelectionBubble {
  top: number;
  left: number;
}

export interface BubbleAnchor {
  start: { top: number; left: number };
  end: { bottom: number };
}

export interface BubbleBox {
  width: number;
  height: number;
}

const FALLBACK_BOX: BubbleBox = { width: 200, height: 32 };
const BUBBLE_GAP = 8;

export function bubblePlace(anchor: BubbleAnchor, viewport: { width: number }, box: BubbleBox = FALLBACK_BOX): SelectionBubble {
  const width = box.width || FALLBACK_BOX.width;
  const height = box.height || FALLBACK_BOX.height;
  const above = anchor.start.top - height - BUBBLE_GAP;
  const top = above >= BUBBLE_GAP ? above : anchor.end.bottom + BUBBLE_GAP;
  return { top, left: Math.max(BUBBLE_GAP, Math.min(anchor.start.left, viewport.width - width - BUBBLE_GAP)) };
}
