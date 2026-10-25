// The usage snapshot for the built-in assistant: the chat's totals, the
// last run, the context in use, and (when the popover opens) the project
// budget, the provider's credit and the chat's cost from the usage ledger.
import { i18n } from "@/i18n";
import { HISTORY_MAX_TURNS } from "@/lib/ai-context-pack";
import { providerCredit } from "@/lib/agent-backend";
import { budgetGet, usageSummary } from "@/lib/tauri";
import type { ChatUsage } from "@/store/chats";
import type { UsageSnapshot } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RunUsageView {
  input: number | null;
  output: number | null;
  steps: number;
  cacheRead?: number | null;
  cacheWrite?: number | null;
}

export function builtinUsageSnapshot(input: {
  chatUsage?: ChatUsage;
  runUsage?: RunUsageView | null;
  context?: { used: number; size: number } | null;
  droppedTurns?: number;
}): UsageSnapshot {
  const snapshot: UsageSnapshot = {};
  if (input.context) snapshot.context = { ...input.context };
  if (input.runUsage) {
    snapshot.lastTurn = {
      inputTokens: input.runUsage.input ?? undefined,
      outputTokens: input.runUsage.output ?? undefined,
      steps: input.runUsage.steps,
    };
  }
  const usage = input.chatUsage;
  if (usage) {
    const session: NonNullable<UsageSnapshot["session"]> = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      turns: usage.runs,
      steps: usage.steps,
    };
    if (usage.cacheReadTokens !== undefined) session.cachedReadTokens = usage.cacheReadTokens;
    if (usage.cacheWriteTokens !== undefined) session.cachedWriteTokens = usage.cacheWriteTokens;
    if ((usage.estimatedUsd ?? 0) > 0) session.costUsd = usage.estimatedUsd;
    snapshot.session = session;
  }
  const notes: string[] = [];
  if ((input.droppedTurns ?? 0) > 0) {
    notes.push(i18n.t(($) => $.ai.usage.historyTrimmed, { count: HISTORY_MAX_TURNS }));
  }
  notes.push(i18n.t(($) => $.ai.usage.cacheNote));
  snapshot.notes = notes;
  return snapshot;
}

async function projectBudget(projectId: string): Promise<UsageSnapshot["budget"]> {
  const limit = await budgetGet(projectId);
  if (limit === null || limit === undefined) return undefined;
  const totals = await usageSummary(projectId);
  return { spentUsd: totals.cost_usd, limitUsd: limit };
}

/**
 * The chat's cost from the usage ledger, its subagents included (their rows
 * carry their own session id and name the chat as their parent), when its
 * records carry prices.
 */
export async function ledgerChatCost(threadId: string, chatCreatedAt: number): Promise<number | undefined> {
  const { createUsageReportFilter, queryUsageReport } = await import("@/lib/usage-report");
  const now = Date.now();
  const report = await queryUsageReport(
    createUsageReportFilter(
      {
        startMs: chatCreatedAt - DAY_MS,
        endMs: now + DAY_MS,
        sessionIds: [threadId],
        includeChildSessions: true,
        pageSize: 1,
      },
      now,
    ),
  );
  return report.totals.costKnownRecords > 0 ? report.totals.estimatedCostUsd : undefined;
}

/** Loads the popover's extras; each part that fails is left out. */
export function builtinUsageExtras(input: {
  projectId: string | null;
  providerId: string;
  threadId: string | null;
  chatCreatedAt: number | null;
}): () => Promise<Partial<UsageSnapshot>> {
  return async () => {
    const [budget, credit, cost] = await Promise.allSettled([
      input.projectId ? projectBudget(input.projectId) : Promise.resolve(undefined),
      providerCredit(input.providerId),
      input.threadId && input.chatCreatedAt !== null
        ? ledgerChatCost(input.threadId, input.chatCreatedAt)
        : Promise.resolve(undefined),
    ]);
    const extras: Partial<UsageSnapshot> = {};
    if (budget.status === "fulfilled" && budget.value) extras.budget = budget.value;
    if (credit.status === "fulfilled" && credit.value && credit.value.remaining !== null) {
      extras.credit = {
        remainingUsd: credit.value.remaining,
        limitUsd: credit.value.limit ?? undefined,
        source: credit.value.source,
        currency: credit.value.currency,
      };
    }
    if (cost.status === "fulfilled" && cost.value !== undefined) {
      extras.session = { costUsd: cost.value };
    }
    return extras;
  };
}
