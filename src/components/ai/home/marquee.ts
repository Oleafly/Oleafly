export type MarqueeDirection = 1 | -1;

export interface MarqueePosition {
  position: number;
  direction: MarqueeDirection;
}

export function marqueeStep(
  position: number,
  max: number,
  direction: MarqueeDirection,
  distance: number,
): MarqueePosition {
  if (!Number.isFinite(max) || max <= 0) return { position: 0, direction };
  const clamped = Math.min(Math.max(position, 0), max);
  const next = clamped + direction * Math.max(distance, 0);
  if (next >= max) return { position: max, direction: -1 };
  if (next <= 0) return { position: 0, direction: 1 };
  return { position: next, direction };
}
