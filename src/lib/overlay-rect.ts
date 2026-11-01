import { ASSISTANT_MIN_WIDTH } from "./assistant-layout";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Viewport { width: number; height: number }

export const OVERLAY_MIN_W = ASSISTANT_MIN_WIDTH;
export const OVERLAY_MIN_H = 400;
export const OVERLAY_MIN_W_FRACTION = 0.3;

export function overlayMinWidth(
  viewportWidth: number,
  minimumWidth = OVERLAY_MIN_W,
): number {
  return Math.min(
    viewportWidth,
    Math.max(minimumWidth, Math.round(viewportWidth * OVERLAY_MIN_W_FRACTION)),
  );
}

export function clampRect(
  rect: Rect,
  vp: Viewport,
  minimumWidth = OVERLAY_MIN_W,
): Rect {
  const w = Math.min(
    Math.max(rect.w, overlayMinWidth(vp.width, minimumWidth)),
    vp.width,
  );
  const h = Math.min(Math.max(rect.h, OVERLAY_MIN_H), vp.height);
  const x = Math.min(Math.max(rect.x, 0), Math.max(0, vp.width - w));
  const y = Math.min(Math.max(rect.y, 0), Math.max(0, vp.height - h));
  return { x, y, w, h };
}
