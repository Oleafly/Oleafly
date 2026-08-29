export const AUTO_COMPILE_DEBOUNCE_MS = 2500;
export const AUTO_COMPILE_RETRY_MS = 500;

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
  debounceMs = AUTO_COMPILE_DEBOUNCE_MS,
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
