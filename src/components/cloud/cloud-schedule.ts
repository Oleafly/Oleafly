import type { CloudSyncInterval } from "@/store/cloud";

export const CLOUD_SYNC_INTERVAL_MS: Readonly<Record<Exclude<CloudSyncInterval, "manual">, number>> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "60m": 60 * 60_000,
};

export const FIRST_ROUND_DELAY_MS = 20_000;
export const HIDDEN_MIN_INTERVAL_MS = 5 * 60_000;
export const MAX_BACKOFF_MS = 30 * 60_000;
export const SETTINGS_DEBOUNCE_MS = 3_000;

export function nextRoundDelay(
  interval: Exclude<CloudSyncInterval, "manual">,
  hidden: boolean,
  failureStreak: number,
): number {
  const chosen = CLOUD_SYNC_INTERVAL_MS[interval];
  const base = hidden ? Math.max(chosen, HIDDEN_MIN_INTERVAL_MS) : chosen;
  if (failureStreak <= 0) return base;
  return Math.max(base, Math.min(MAX_BACKOFF_MS, base * 2 ** failureStreak));
}
