import { i18n } from "@/i18n";
import { budgetGet, usageSummary } from "@/lib/tauri";
import { formatUsd } from "@/lib/ai-pricing";
import { toast } from "@/lib/toast";

export type BudgetGate = "ok" | "warned" | "blocked";

export async function checkProjectBudget(projectId: string): Promise<BudgetGate> {
  try {
    const budget = await budgetGet(projectId);
    if (!budget || budget <= 0) return "ok";
    const totals = await usageSummary(projectId);
    if (totals.cost_usd >= budget) {
      toast.errorUnique(
        `ai-budget-stop:${projectId}`,
        i18n.t(($) => $.core.aiBudget.blocked, { budget: formatUsd(budget) }),
      );
      return "blocked";
    }
    if (totals.cost_usd >= budget * 0.8) {
      toast.infoUnique(
        `ai-budget-warn:${projectId}`,
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
