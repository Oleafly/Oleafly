import type { UsageSnapshot, UsageWindow } from "./types";

export type UsageTone = "normal" | "warning" | "critical";

/** Under 75% normal, 75–90% warning, over 90% critical. */
export function usageTone(fraction: number): UsageTone {
  if (!Number.isFinite(fraction)) return "normal";
  if (fraction > 0.9) return "critical";
  if (fraction >= 0.75) return "warning";
  return "normal";
}

export const USAGE_TONE_TEXT: Record<UsageTone, string> = {
  normal: "text-primary",
  warning: "text-amber-600 dark:text-amber-400",
  critical: "text-destructive",
};

export const USAGE_TONE_BAR: Record<UsageTone, string> = {
  normal: "bg-primary",
  warning: "bg-amber-500",
  critical: "bg-destructive",
};

/** The share of the context window in use, 0..1, or null when unknown. */
export function contextFraction(snapshot: UsageSnapshot): number | null {
  const context = snapshot.context;
  if (!context || Number.isNaN(context.size) || context.size <= 0 || !Number.isFinite(context.used)) return null;
  return Math.min(1, Math.max(0, context.used / context.size));
}

/** A plan window's status counts before its utilization. */
export function windowTone(window: UsageWindow): UsageTone {
  if (window.status === "blocked") return "critical";
  if (window.status === "warning") return "warning";
  return usageTone(window.utilization);
}
