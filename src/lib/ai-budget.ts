import { i18n } from "@/i18n";
import { budgetGet, usageSummary } from "@/lib/tauri";
import { formatUsd } from "@/lib/ai-pricing";
import { useToastStore } from "@/store/toast";

export type BudgetGate = "ok" | "warned" | "blocked";

// Soft warning past 80% of the project's AI budget, hard stop at 100%.
// Ledger problems never block a run; the budget is a guard rail, not a lock
// the user cannot get past when the database is unavailable.
export async function checkProjectBudget(projectId: string): Promise<BudgetGate> {
  try {
    const budget = await budgetGet(projectId);
    if (!budget || budget <= 0) return "ok";
    const totals = await usageSummary(projectId);
    if (totals.cost_usd >= budget) {
      useToastStore
        .getState()
        .pushUnique(
          `ai-budget-stop:${projectId}`,
          "error",
          i18n.t(($) => $.core.aiBudget.blocked, { budget: formatUsd(budget) }),
        );
      return "blocked";
    }
    if (totals.cost_usd >= budget * 0.8) {
      useToastStore
        .getState()
        .pushUnique(
          `ai-budget-warn:${projectId}`,
          "info",
          i18n.t(($) => $.core.aiBudget.warned, {
            spent: formatUsd(totals.cost_usd),
            budget: formatUsd(budget),
          }),
        );
      return "warned";
    }
    return "ok";
  } catch {
    return "ok";
  }
}
