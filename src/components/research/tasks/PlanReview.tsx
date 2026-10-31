import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/empty";
import { Textarea } from "@/components/ui/textarea";
import { describeError } from "@/lib/app-error";
import {
  loadResearchTaskPlan,
  MAX_PLAN_BYTES,
  type ResearchTask,
  type TaskPlanText,
} from "@/lib/research-tasks";

interface PlanReviewProps {
  task: ResearchTask;
  busy: boolean;
  onApprove: (editedPlan?: string) => Promise<void>;
  onDiscard: () => Promise<void>;
}

const encoder = new TextEncoder();

export function PlanReview({ task, busy, onApprove, onDiscard }: Readonly<PlanReviewProps>) {
  const { t } = useTranslation(["common", "researchTools"]);
  const [loaded, setLoaded] = useState<{ key: string; plan: TaskPlanText } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [attempt, setAttempt] = useState(0);
  const taskKey = `${task.id}:${task.executionGeneration}`;
  const plan = loaded?.key === taskKey ? loaded.plan : null;
  const original = plan?.text ?? null;
  const failed = failure?.key === taskKey ? failure.message : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: Try again loads the plan again
  useEffect(() => {
    let current = true;
    loadResearchTaskPlan(task.id)
      .then((next) => {
        if (!current) return;
        setLoaded({ key: taskKey, plan: next });
        setFailure(null);
        setDraft(next.text);
      })
      .catch((cause: unknown) => {
        if (current) setFailure({ key: taskKey, message: describeError(cause) });
      });
    return () => {
      current = false;
    };
  }, [taskKey, task.id, attempt]);

  const retry = useCallback(() => {
    setFailure(null);
    setAttempt((value) => value + 1);
  }, []);

  const edited = original !== null && draft.trim() !== original.trim();
  const tooLong = edited && encoder.encode(draft).length > MAX_PLAN_BYTES;
  const needsEdit = plan?.truncated === true && !edited;

  let body: ReactNode;
  if (failed !== null) {
    body = (
      <ErrorState size="compact" message={t(($) => $.researchTools.tasks.plan.loadFailed)}>
        <p className="select-text break-words text-xs text-muted-foreground">{failed}</p>
        <Button size="xs" variant="outline" onClick={retry}>
          {t(($) => $.common.actions.retry)}
        </Button>
      </ErrorState>
    );
  } else if (original === null) {
    body = <LoadingState size="compact" label={t(($) => $.researchTools.tasks.plan.loading)} />;
  } else {
    body = (
      <Textarea
        aria-labelledby="research-task-plan"
        aria-invalid={tooLong || undefined}
        className="min-h-64 font-mono text-xs"
        disabled={busy}
        value={draft}
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
      {plan?.truncated ? (
        <p
          role="alert"
          data-testid="research-task-plan-truncated"
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
        >
          <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{t(($) => $.researchTools.tasks.plan.truncated)}</span>
        </p>
      ) : null}
      {body}
      {tooLong ? (
        <p role="alert" className="text-xs text-destructive">
          {t(($) => $.researchTools.tasks.plan.tooLong)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" disabled={busy} onClick={() => void onDiscard().catch(() => {})}>
          {t(($) => $.researchTools.tasks.plan.discard)}
        </Button>
        <Button
          disabled={busy || original === null || needsEdit || tooLong}
          onClick={() => void onApprove(edited ? draft : undefined).catch(() => {})}
        >
          {edited ? t(($) => $.researchTools.tasks.plan.approveEdited) : t(($) => $.researchTools.tasks.plan.approve)}
        </Button>
      </div>
    </section>
  );
}
