export function isWebKitGtk(userAgent: string): boolean {
  return (
    /\b(X11|Linux)\b/.test(userAgent) &&
    /AppleWebKit\//.test(userAgent) &&
    !/\b(Chrome|Chromium|Edg|Android)\b/.test(userAgent)
  );
}

export function dropNativeDecompression(
  scope: { DecompressionStream?: unknown },
  userAgent: string,
): boolean {
  if (!isWebKitGtk(userAgent) || scope.DecompressionStream === undefined) return false;
  if (!Reflect.deleteProperty(scope, "DecompressionStream")) {
    Reflect.set(scope, "DecompressionStream", undefined);
  }
  return scope.DecompressionStream === undefined;
}
