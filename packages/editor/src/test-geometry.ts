export function stubRangeGeometry(): void {
  if (typeof Range === "undefined" || "getClientRects" in Range.prototype) return;
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}
