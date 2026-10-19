import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/empty";
import { Textarea } from "@/components/ui/textarea";
import { loadResearchTaskPlan, type ResearchTask } from "@/lib/research-tasks";

interface PlanReviewProps {
  task: ResearchTask;
  busy: boolean;
  onApprove: (editedPlan?: string) => Promise<void>;
  onDiscard: () => Promise<void>;
}

/** The plan a plan-first task wrote, editable, with Approve and Discard. */
export function PlanReview({ task, busy, onApprove, onDiscard }: Readonly<PlanReviewProps>) {
  const { t } = useTranslation(["researchTools"]);
  const [original, setOriginal] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [missing, setMissing] = useState(false);
  const taskKey = `${task.id}:${task.executionGeneration}`;

  useEffect(() => {
    let current = true;
    setOriginal(null);
    setMissing(false);
    loadResearchTaskPlan(task.id)
      .then((plan) => {
        if (!current) return;
        setOriginal(plan);
        setDraft(plan);
      })
      .catch(() => {
        if (current) setMissing(true);
      });
    return () => {
      current = false;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the task's run changes
  }, [taskKey]);

  const edited = original !== null && draft.trim() !== original.trim();

  return (
    <section aria-labelledby="research-task-plan" className="space-y-3" data-testid="research-task-plan">
      <div>
        <h4 id="research-task-plan" className="text-sm font-medium">
          {t(($) => $.researchTools.tasks.plan.title)}
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">{t(($) => $.researchTools.tasks.plan.description)}</p>
      </div>
      {missing ? (
        <p role="alert" className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          {t(($) => $.researchTools.tasks.plan.missing)}
        </p>
      ) : original === null ? (
        <LoadingState size="compact" label={t(($) => $.researchTools.tasks.plan.loading)} />
      ) : (
        <Textarea
          aria-labelledby="research-task-plan"
          className="min-h-64 font-mono text-xs"
          disabled={busy}
          value={draft}
          maxLength={64 * 1024}
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" disabled={busy} onClick={() => void onDiscard().catch(() => {})}>
          {t(($) => $.researchTools.tasks.plan.discard)}
        </Button>
        <Button
          disabled={busy || original === null}
          onClick={() => void onApprove(edited ? draft : undefined).catch(() => {})}
        >
          {edited ? t(($) => $.researchTools.tasks.plan.approveEdited) : t(($) => $.researchTools.tasks.plan.approve)}
        </Button>
      </div>
    </section>
  );
}
