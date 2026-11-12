export interface SelectionBubble {
  top: number;
  left: number;
}

const BUBBLE_HEIGHT = 40;
const BUBBLE_WIDTH = 200;
const BUBBLE_GAP = 8;

export function bubblePlace(start: { top: number; left: number }, end: { bottom: number }, viewport: { width: number }): SelectionBubble {
  const above = start.top - BUBBLE_HEIGHT;
  const top = above >= BUBBLE_GAP ? above : end.bottom + BUBBLE_GAP;
  return { top, left: Math.max(BUBBLE_GAP, Math.min(start.left, viewport.width - BUBBLE_WIDTH)) };
}
