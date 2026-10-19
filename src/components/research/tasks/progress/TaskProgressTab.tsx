import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Circle, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/empty";
import { i18n } from "@/i18n";
import {
  cancelResearchTaskRun,
  progressResearchTask,
  researchTaskRunLog,
  type ResearchTask,
  type RunRecord,
  type TaskProgress,
} from "@/lib/research-tasks";
import { durationLabel } from "../brief/BriefFields";
import { relativeTime, runStateLabel } from "../task-status";
import { Sparkline } from "./Sparkline";

const POLL_EVERY_MS = 3_000;

function verdictLabel(verdict: string): string {
  switch (verdict.trim().toLowerCase()) {
    case "keep":
      return i18n.t(($) => $.researchTools.tasks.progress.verdict.keep);
    case "discard":
      return i18n.t(($) => $.researchTools.tasks.progress.verdict.discard);
    case "crash":
      return i18n.t(($) => $.researchTools.tasks.progress.verdict.crash);
    default:
      return verdict;
  }
}

function formatValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return Number(value.toPrecision(4)).toString();
}

function metricsText(metrics: Record<string, number>): string {
  return Object.entries(metrics)
    .map(([name, value]) => `${name}=${formatValue(value)}`)
    .join(", ");
}

function money(value: number): string {
  return value < 10 ? value.toFixed(2) : value.toFixed(0);
}

/** The task's plan, ledger, runs, best result and budget, refreshed while it runs. */
export function TaskProgressTab({ task }: Readonly<{ task: ResearchTask }>) {
  const { t } = useTranslation(["researchTools"]);
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<{ runId: string; text: string } | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const running = task.status === "running";

  const load = useCallback(async () => {
    try {
      const next = await progressResearchTask(task.id);
      setProgress(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [task.id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a task update means new progress to show
  useEffect(() => {
    void load();
  }, [load, task.updatedAt]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [load, running]);

  const viewLog = async (run: RunRecord) => {
    try {
      setLog({ runId: run.runId, text: await researchTaskRunLog(task.id, run.runId) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const stopRun = async (run: RunRecord) => {
    setStopping(run.runId);
    try {
      await cancelResearchTaskRun(task.id, run.runId);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStopping(null);
    }
  };

  if (!progress) {
    return error ? (
      <p role="alert" className="select-text text-sm text-destructive">
        {error}
      </p>
    ) : (
      <LoadingState size="compact" label={t(($) => $.researchTools.tasks.progress.loading)} />
    );
  }

  const { budget, best } = progress;
  // Runs come by value from each refresh, so they are matched by id.
  const finishedRuns = progress.recentRuns
    .filter((run) => !progress.runsInFlight.some((live) => live.runId === run.runId))
    .slice(0, 8);
  const costText = () => {
    if (budget.spentUsd === null) return t(($) => $.researchTools.tasks.progress.costUnknown);
    if (budget.usdCap !== null) {
      return t(($) => $.researchTools.tasks.progress.costUsed, {
        used: money(budget.spentUsd),
        limit: money(budget.usdCap),
      });
    }
    return t(($) => $.researchTools.tasks.progress.costSpent, { used: money(budget.spentUsd) });
  };

  return (
    <div className="space-y-5" data-testid="research-task-progress">
      {error ? (
        <p role="alert" className="select-text text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {best ? (
          <section className="rounded-md border p-3" aria-labelledby="research-progress-best">
            <h4 id="research-progress-best" className="text-xs font-medium text-muted-foreground">
              {t(($) => $.researchTools.tasks.progress.best, { metric: best.name })}
            </h4>
            <div className="mt-1 flex items-end justify-between gap-3">
              <p className="text-sm tabular-nums">
                {t(($) => $.researchTools.tasks.progress.bestValue, {
                  value: formatValue(best.value),
                  run: best.runId,
                })}
              </p>
              <Sparkline
                values={best.series}
                className="shrink-0 text-primary"
                label={t(($) => $.researchTools.tasks.progress.best, { metric: best.name })}
              />
            </div>
          </section>
        ) : null}
        <section className="rounded-md border p-3" aria-labelledby="research-progress-budget">
          <h4 id="research-progress-budget" className="text-xs font-medium text-muted-foreground">
            {t(($) => $.researchTools.tasks.progress.budget)}
          </h4>
          <ul className="mt-1 space-y-0.5 text-sm tabular-nums">
            <li>
              {t(($) => $.researchTools.tasks.progress.timeUsed, {
                used: durationLabel(Math.round(budget.activeMinutes)),
                total: durationLabel(budget.limitMinutes),
              })}
            </li>
            <li>{costText()}</li>
            <li>
              {budget.maxRuns !== null
                ? t(($) => $.researchTools.tasks.progress.runsUsed, {
                    used: budget.runsStarted,
                    limit: budget.maxRuns,
                  })
                : t(($) => $.researchTools.tasks.progress.runsUsedNoLimit, { used: budget.runsStarted })}
            </li>
          </ul>
        </section>
      </div>

      <section aria-labelledby="research-progress-runs" className="space-y-2">
        <h4 id="research-progress-runs" className="text-sm font-medium">
          {t(($) => $.researchTools.tasks.progress.runsInFlight)}
        </h4>
        {progress.runsInFlight.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t(($) => $.researchTools.tasks.progress.noRuns)}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {progress.runsInFlight.map((run) => (
              <li key={run.runId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{run.runId}</span>
                <span className="min-w-0 flex-1 truncate">{run.name}</span>
                <span className="text-xs text-muted-foreground">{runStateLabel(run.state)}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{relativeTime(run.startedAt)}</span>
                <Button size="xs" variant="outline" onClick={() => void viewLog(run)}>
                  {t(($) => $.researchTools.tasks.progress.viewLog)}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={stopping === run.runId}
                  onClick={() => void stopRun(run)}
                >
                  {t(($) => $.researchTools.tasks.progress.stopRun)}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {finishedRuns.length > 0 ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {finishedRuns.map((run) => (
              <li key={run.runId} className="flex flex-wrap items-center gap-x-3">
                <span className="font-mono">{run.runId}</span>
                <span className="min-w-0 flex-1 truncate">{run.name}</span>
                <span>{runStateLabel(run.state)}</span>
                {Object.keys(run.metrics).length > 0 ? (
                  <span className="truncate font-mono">{metricsText(run.metrics)}</span>
                ) : null}
                <button
                  type="button"
                  className="rounded px-1 text-primary hover:bg-muted hover:underline"
                  onClick={() => void viewLog(run)}
                >
                  {t(($) => $.researchTools.tasks.progress.viewLog)}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {log ? (
          <section aria-label={log.runId}>
            <pre
              data-select-all-scope
              className="max-h-72 select-text overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/30 p-3 text-xs"
            >
              {log.text}
            </pre>
          </section>
        ) : null}
      </section>

      <section aria-labelledby="research-progress-plan" className="space-y-2">
        <h4 id="research-progress-plan" className="text-sm font-medium">
          {t(($) => $.researchTools.tasks.progress.plan)}
        </h4>
        {progress.plan.length === 0 && progress.todos.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t(($) => $.researchTools.tasks.progress.noPlan)}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {progress.plan.map((item, index) => (
              <li key={`plan-${index}`} className="flex items-start gap-2">
                {item.done ? (
                  <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
                ) : (
                  <Circle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className={item.done ? "text-muted-foreground line-through" : undefined}>{item.text}</span>
              </li>
            ))}
            {progress.todos.map((todo) => (
              <li key={`todo-${todo.id}`} className="flex items-start gap-2 text-muted-foreground">
                {todo.status === "completed" ? (
                  <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                ) : todo.status === "in_progress" ? (
                  <CircleDot aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
                ) : (
                  <Circle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                )}
                <span className={todo.status === "cancelled" ? "line-through" : undefined}>{todo.content}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="research-progress-ledger" className="space-y-2">
        <h4 id="research-progress-ledger" className="text-sm font-medium">
          {t(($) => $.researchTools.tasks.progress.ledger)}
        </h4>
        {progress.ledger.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t(($) => $.researchTools.tasks.progress.noLedger)}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[40rem] text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">{t(($) => $.researchTools.tasks.progress.columns.run)}</th>
                  <th className="px-2 py-1.5 font-medium">{t(($) => $.researchTools.tasks.progress.columns.time)}</th>
                  <th className="px-2 py-1.5 font-medium">
                    {t(($) => $.researchTools.tasks.progress.columns.hypothesis)}
                  </th>
                  <th className="px-2 py-1.5 font-medium">{t(($) => $.researchTools.tasks.progress.columns.change)}</th>
                  <th className="px-2 py-1.5 font-medium">
                    {t(($) => $.researchTools.tasks.progress.columns.metrics)}
                  </th>
                  <th className="px-2 py-1.5 font-medium">
                    {t(($) => $.researchTools.tasks.progress.columns.verdict)}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {progress.ledger.map((row, index) => (
                  <tr key={`${row.id}-${index}`} className="align-top">
                    <td className="px-2 py-1.5 font-mono">{row.id}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">{row.time}</td>
                    <td className="px-2 py-1.5">{row.hypothesis}</td>
                    <td className="px-2 py-1.5">{row.change}</td>
                    <td className="px-2 py-1.5 font-mono">{metricsText(row.metrics)}</td>
                    <td className="px-2 py-1.5">{verdictLabel(row.verdict)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
