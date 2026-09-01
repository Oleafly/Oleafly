import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { budgetGet, budgetSet, usageSummary } from "@/lib/tauri";
import { formatUsd } from "@/lib/ai-pricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFilesStore } from "@/store/files";

// Per-project AI spend controls: shows the ledger total and edits the budget
// that gates new runs (soft warning at 80%, hard stop at 100%).
export function ProjectBudget() {
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
  const spent = usage.data ? formatUsd(usage.data.cost_usd) : null;

  return (
    <div className="rounded-lg border bg-card p-3" data-testid="project-budget">
      <div className="text-sm font-medium">AI budget</div>
      <div className="mb-2 text-xs text-muted-foreground">
        {spent
          ? `Estimated spend so far: ${spent}. Runs pause once the budget is reached.`
          : "Runs pause once the budget is reached."}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">$</span>
        <Input
          aria-label="AI budget in US dollars"
          inputMode="decimal"
          value={value}
          placeholder="No budget"
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
          Save budget
        </Button>
        {budget.data != null && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            Clear budget
          </Button>
        )}
      </div>
    </div>
  );
}
