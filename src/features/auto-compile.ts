/// Floor for the adaptive debounce: fast enough that a light document feels
/// live, slow enough that a burst of keystrokes still coalesces into one build.
export const AUTO_COMPILE_MIN_DEBOUNCE_MS = 400;
/// Ceiling for the adaptive debounce, and the wait used for a document whose
/// cost is not known yet. A heavy document is never debounced longer than this.
export const AUTO_COMPILE_MAX_DEBOUNCE_MS = 2500;
export const AUTO_COMPILE_RETRY_MS = 150;

/**
 * How long to wait after an edit before rebuilding, given what the last build
 * of this document cost. Waiting roughly one build's worth keeps the machine
 * at about half duty cycle: a 600ms document rebuilds on a 600ms pause, while
 * a book-sized one keeps the old 2.5s wait instead of thrashing.
 */
export function autoCompileDebounceMs(lastCompileMs: number | null): number {
  if (lastCompileMs === null || !Number.isFinite(lastCompileMs)) {
    return AUTO_COMPILE_MIN_DEBOUNCE_MS;
  }
  return Math.min(
    AUTO_COMPILE_MAX_DEBOUNCE_MS,
    Math.max(AUTO_COMPILE_MIN_DEBOUNCE_MS, Math.round(lastCompileMs)),
  );
}

export interface AutoCompileSnapshot {
  status: string;
  compileStartedAt: number | null;
}

export interface AutoCompileSchedulerOptions {
  editedAt: number;
  getSnapshot: () => AutoCompileSnapshot;
  recompile: () => unknown;
  stopCompile: () => unknown;
  debounceMs?: number;
  retryMs?: number;
}

/**
 * Debounce an edit into a recompile, stopping a build that started before the
 * edit rather than waiting for it to finish. The stale build is asked to stop
 * once; every later poll only waits, so a slow shutdown does not queue up a
 * stream of stop requests. Returns the cancel function for effect cleanup.
 */
export function scheduleAutoCompile({
  editedAt,
  getSnapshot,
  recompile,
  stopCompile,
  debounceMs = AUTO_COMPILE_MAX_DEBOUNCE_MS,
  retryMs = AUTO_COMPILE_RETRY_MS,
}: AutoCompileSchedulerOptions): () => void {
  let timer: ReturnType<typeof setTimeout>;
  let cancelled = false;
  let stopRequested = false;

  const attempt = () => {
    if (cancelled) return;
    const compile = getSnapshot();
    if (compile.status === "compiling") {
      if (
        !stopRequested &&
        compile.compileStartedAt !== null &&
        compile.compileStartedAt < editedAt
      ) {
        stopRequested = true;
        void stopCompile();
      }
      timer = setTimeout(attempt, retryMs);
      return;
    }
    void recompile();
  };

  timer = setTimeout(attempt, debounceMs);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
