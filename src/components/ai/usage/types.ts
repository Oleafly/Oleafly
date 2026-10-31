export interface UsageWindow {
  id: string;
  label: string;
  utilization: number;
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
  credit?: { remainingUsd?: number; limitUsd?: number; source: string; currency?: string };
  budget?: { spentUsd: number; limitUsd?: number };
  notes?: string[];
  planMarkdown?: string;
}
