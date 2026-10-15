export function isWebKit(userAgent: string): boolean {
  return /AppleWebKit\//.test(userAgent) && !/Chrom(?:e|ium)\//.test(userAgent);
}

export function dropNativeDecompression(
  scope: { DecompressionStream?: unknown },
  userAgent: string,
): boolean {
  if (!isWebKit(userAgent) || scope.DecompressionStream === undefined) return false;
  if (!Reflect.deleteProperty(scope, "DecompressionStream")) {
    Reflect.set(scope, "DecompressionStream", undefined);
  }
  return scope.DecompressionStream === undefined;
}
