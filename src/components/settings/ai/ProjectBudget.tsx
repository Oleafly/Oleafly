import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { budgetGet, budgetSet, usageSummary } from "@/lib/tauri";
import { formatNumber } from "@/lib/intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFilesStore } from "@/store/files";

// Per-project AI spend controls: shows the ledger total and edits the budget
// that gates new runs (soft warning at 80%, hard stop at 100%).
export function ProjectBudget() {
  const { t } = useTranslation(["settings"]);
  const projectId = useFilesStore((s) => s.projectId);
  const client = useQueryClient();
  const budget = useQuery({
    queryKey: ["project-budget", projectId],
    queryFn: () => budgetGet(projectId ?? ""),
    enabled: !!projectId,
    staleTime: 0,
    meta: { silent: true },
  });
  const usage = useQuery({
    queryKey: ["project-usage", projectId],
    queryFn: () => usageSummary(projectId ?? ""),
    enabled: !!projectId,
    staleTime: 10_000,
    meta: { silent: true },
  });
  // null draft means "not edited": the field shows the saved budget, and a
  // background refetch can never clobber typing in progress.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? (budget.data != null ? String(budget.data) : "");
  const save = useMutation({
    mutationFn: (next: number | null) => budgetSet(projectId ?? "", next),
    onSuccess: () => {
      setDraft(null);
      void client.invalidateQueries({ queryKey: ["project-budget", projectId] });
    },
  });

  if (!projectId) return null;
  const cost = usage.data?.cost_usd ?? null;
  const spent =
    cost === null
      ? null
      : formatNumber(cost, {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: cost < 0.01 ? 4 : cost < 1 ? 3 : 2,
        });

  return (
    <div className="rounded-lg border bg-card p-3" data-testid="project-budget">
      <div className="text-sm font-medium">{t(($) => $.settings.ai.budget.title)}</div>
      <div className="mb-2 text-xs text-muted-foreground">
        {spent
          ? t(($) => $.settings.ai.budget.spent, { amount: spent })
          : t(($) => $.settings.ai.budget.limit)}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{"$"}</span>
        <Input
          aria-label={t(($) => $.settings.ai.budget.inputLabel)}
          inputMode="decimal"
          value={value}
          placeholder={t(($) => $.settings.ai.budget.inputPlaceholder)}
          onChange={(event) => setDraft(event.target.value)}
          className="h-8 w-28"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={save.isPending || Number.isNaN(Number(value)) || value.trim() === ""}
          onClick={() => save.mutate(Number(value))}
        >
          {t(($) => $.settings.ai.budget.save)}
        </Button>
        {budget.data != null && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            {t(($) => $.settings.ai.budget.clear)}
          </Button>
        )}
      </div>
    </div>
  );
}
