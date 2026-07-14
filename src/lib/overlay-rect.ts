export interface Rect { x: number; y: number; w: number; h: number }
export interface Viewport { width: number; height: number }

export const OVERLAY_MIN_W = 320;
export const OVERLAY_MIN_H = 400;

// Never larger than the viewport, so the overlay can't become an effective
// fullscreen window.
export function clampRect(rect: Rect, vp: Viewport): Rect {
  const w = Math.min(Math.max(rect.w, OVERLAY_MIN_W), vp.width);
  const h = Math.min(Math.max(rect.h, OVERLAY_MIN_H), vp.height);
  const x = Math.min(Math.max(rect.x, 0), Math.max(0, vp.width - w));
  const y = Math.min(Math.max(rect.y, 0), Math.max(0, vp.height - h));
  return { x, y, w, h };
}
