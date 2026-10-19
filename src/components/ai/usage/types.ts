// What the usage meter shows, for the built-in assistant and CLI agents
// (contract C-2). Every section is optional; the popover shows what it has.

export interface UsageWindow {
  id: string;
  label: string;
  /** 0..1 */
  utilization: number;
  /** Epoch ms. */
  resetsAt?: number;
  status?: "ok" | "warning" | "blocked";
}

export interface UsageSnapshot {
  context?: { used: number; size: number };
  session?: {
    costUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
    thoughtTokens?: number;
    cachedReadTokens?: number;
    cachedWriteTokens?: number;
    turns?: number;
    steps?: number;
  };
  lastTurn?: { inputTokens?: number; outputTokens?: number; thoughtTokens?: number; steps?: number };
  plan?: { label?: string; windows: UsageWindow[] };
  /** Amounts in `currency` (USD when absent). */
  credit?: { remainingUsd?: number; limitUsd?: number; source: string; currency?: string };
  budget?: { spentUsd: number; limitUsd?: number };
  /** Short notes, such as trimmed history. */
  notes?: string[];
  /** The rendered result of an on-demand plan usage refresh. */
  planMarkdown?: string;
}
