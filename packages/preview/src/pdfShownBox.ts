export interface ShownPageGeometry {
  viewBox: number[];
  convertToViewportPoint(x: number, y: number): number[];
}

export interface ShownBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function shownBox(
  rect: { x: number; y: number; width: number; height: number },
  geometry: ShownPageGeometry,
  minHeight: number,
): ShownBox {
  const height = Math.max(rect.height, minHeight);
  const [left, , , top] = geometry.viewBox;
  const [a, b] = geometry.convertToViewportPoint(left + rect.x, top - rect.y);
  const [c, d] = geometry.convertToViewportPoint(left + rect.x + rect.width, top - rect.y - height);
  return { left: Math.min(a, c), top: Math.min(b, d), width: Math.abs(c - a), height: Math.abs(d - b) };
}
