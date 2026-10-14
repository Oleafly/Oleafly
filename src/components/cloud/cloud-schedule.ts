export const FIRST_ROUND_DELAY_MS = 20_000;
export const CHANGE_DELAY_MS = 3_000;
export const MIN_ROUND_GAP_MS = 10_000;
export const CHECK_VISIBLE_MS = 5 * 60_000;
export const CHECK_HIDDEN_MS = 15 * 60_000;
export const RETRY_BASE_MS = 30_000;
export const SETTINGS_DEBOUNCE_MS = 3_000;
export const WAIT_RETRY_MS = 30_000;
export const MAX_WAIT_RETRY_MS = 5 * 60_000;

export function nextCheckDelay(hidden: boolean, failureStreak: number): number {
  const base = hidden ? CHECK_HIDDEN_MS : CHECK_VISIBLE_MS;
  if (failureStreak <= 0) return base;
  return Math.min(base, RETRY_BASE_MS * 2 ** (failureStreak - 1));
}

export function waitRetryDelay(failures: number): number {
  return Math.min(MAX_WAIT_RETRY_MS, WAIT_RETRY_MS * 2 ** Math.max(0, failures - 1));
}
