export interface IdleOptions {
  readonly fallbackMs: number;
  readonly timeout?: number;
}

export function hasIdleCallbacks(): boolean {
  return typeof globalThis.requestIdleCallback === "function";
}

export function scheduleIdle(run: (deadline?: IdleDeadline) => void, { fallbackMs, timeout }: IdleOptions): () => void {
  if (hasIdleCallbacks()) {
    const id = globalThis.requestIdleCallback(run, timeout === undefined ? undefined : { timeout });
    return () => globalThis.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(() => run(), fallbackMs);
  return () => globalThis.clearTimeout(id);
}
