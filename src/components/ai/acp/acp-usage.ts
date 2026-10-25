import type { UsageSnapshot, UsageWindow } from "@/components/ai/usage/types";
import { i18n } from "@/i18n";
import type { AcpSession, AcpSessionUsage } from "@/lib/acp";
import { formatNumber } from "@/lib/intl";

const WINDOW_LABELS: Record<string, () => string> = {
  five_hour: () => i18n.t(($) => $.ai.acp.usage.window.fiveHour),
  seven_day: () => i18n.t(($) => $.ai.acp.usage.window.weekly),
  seven_day_opus: () => i18n.t(($) => $.ai.acp.usage.window.weeklyOpus),
  seven_day_sonnet: () => i18n.t(($) => $.ai.acp.usage.window.weeklySonnet),
  overage: () => i18n.t(($) => $.ai.acp.usage.window.overage),
};

export function rateLimitLabel(id: string): string {
  return WINDOW_LABELS[id]?.() ?? i18n.t(($) => $.ai.acp.usage.window.other, { id });
}

function windowStatus(status: string): UsageWindow["status"] {
  if (status === "rejected") return "blocked";
  if (status === "allowed_warning") return "warning";
  return "ok";
}

/** The usage meter's view of what a CLI agent reported. */
export function toUsageSnapshot(usage: AcpSessionUsage | null | undefined): UsageSnapshot {
  if (!usage) return {};
  const snapshot: UsageSnapshot = {};
  const notes: string[] = [];
  if (typeof usage.contextUsed === "number" && typeof usage.contextSize === "number" && usage.contextSize > 0) {
    snapshot.context = { used: usage.contextUsed, size: usage.contextSize };
  }
  const tokens = usage.sessionTokens;
  const usd = usage.costCurrency === "USD" || usage.costCurrency == null;
  if (tokens || (usd && typeof usage.costAmount === "number")) {
    snapshot.session = {
      inputTokens: tokens?.inputTokens ?? undefined,
      outputTokens: tokens?.outputTokens ?? undefined,
      thoughtTokens: tokens?.thoughtTokens ?? undefined,
      cachedReadTokens: tokens?.cachedReadTokens ?? undefined,
      cachedWriteTokens: tokens?.cachedWriteTokens ?? undefined,
      costUsd: usd ? usage.costAmount ?? undefined : undefined,
    };
  }
  if (!usd && typeof usage.costAmount === "number" && usage.costCurrency) {
    notes.push(i18n.t(($) => $.ai.acp.usage.costIn, {
      amount: formatNumber(usage.costAmount, { maximumFractionDigits: 4 }),
      currency: usage.costCurrency,
    }));
  }
  if (usage.lastTurn) {
    snapshot.lastTurn = {
      inputTokens: usage.lastTurn.inputTokens ?? undefined,
      outputTokens: usage.lastTurn.outputTokens ?? undefined,
      thoughtTokens: usage.lastTurn.thoughtTokens ?? undefined,
    };
  }
  const windows: UsageWindow[] = (usage.rateLimits ?? [])
    .map((window) => ({
      id: window.id,
      label: rateLimitLabel(window.id),
      utilization: typeof window.utilization === "number" ? window.utilization : 0,
      resetsAt: window.resetsAt ?? undefined,
      status: windowStatus(window.status),
      known: typeof window.utilization === "number",
    }))
    .filter((window) => window.known || window.status !== "ok")
    .map(({ known: _known, ...window }) => window);
  if (windows.length > 0) {
    snapshot.plan = { label: usage.auth?.plan ?? usage.auth?.label ?? undefined, windows };
  }
  for (const entry of (usage.modelUsage ?? []).slice(0, 4)) {
    const total = (entry.tokens.inputTokens ?? 0) + (entry.tokens.outputTokens ?? 0);
    notes.push(i18n.t(($) => $.ai.acp.usage.modelTokens, { model: entry.model, tokens: formatNumber(total) }));
  }
  if (notes.length > 0) snapshot.notes = notes;
  if (usage.planMarkdown) snapshot.planMarkdown = usage.planMarkdown;
  return snapshot;
}

export function canRefreshPlan(session: AcpSession): boolean {
  return (session.availableCommands ?? []).some((command) => command.name === "usage" || command.name === "status");
}

export function usageTooltip(snapshot: UsageSnapshot): string {
  if (snapshot.context && snapshot.context.size > 0) {
    const percent = Math.round((snapshot.context.used / snapshot.context.size) * 100);
    return i18n.t(($) => $.ai.acp.usage.contextShare, { percent });
  }
  return i18n.t(($) => $.ai.acp.usage.tooltip);
}
