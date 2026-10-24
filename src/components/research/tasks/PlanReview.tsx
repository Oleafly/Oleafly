import { type ReactNode, useEffect, useState } from "react";
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
  // The plan, and the failure, are tagged with the run they belong to, so a new run starts empty.
  const [loaded, setLoaded] = useState<{ key: string; plan: string } | null>(null);
  const [missingKey, setMissingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const taskKey = `${task.id}:${task.executionGeneration}`;
  const original = loaded?.key === taskKey ? loaded.plan : null;
  const missing = missingKey === taskKey;

  useEffect(() => {
    let current = true;
    loadResearchTaskPlan(task.id)
      .then((plan) => {
        if (!current) return;
        setLoaded({ key: taskKey, plan });
        setDraft(plan);
      })
      .catch(() => {
        if (current) setMissingKey(taskKey);
      });
    return () => {
      current = false;
    };
  }, [taskKey, task.id]);

  const edited = original !== null && draft.trim() !== original.trim();

  let body: ReactNode;
  if (missing) {
    body = (
      <p role="alert" className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        {t(($) => $.researchTools.tasks.plan.missing)}
      </p>
    );
  } else if (original === null) {
    body = <LoadingState size="compact" label={t(($) => $.researchTools.tasks.plan.loading)} />;
  } else {
    body = (
      <Textarea
        aria-labelledby="research-task-plan"
        className="min-h-64 font-mono text-xs"
        disabled={busy}
        value={draft}
        maxLength={64 * 1024}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  }

  return (
    <section aria-labelledby="research-task-plan" className="space-y-3" data-testid="research-task-plan">
      <div>
        <h4 id="research-task-plan" className="text-sm font-medium">
          {t(($) => $.researchTools.tasks.plan.title)}
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">{t(($) => $.researchTools.tasks.plan.description)}</p>
      </div>
      {body}
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
