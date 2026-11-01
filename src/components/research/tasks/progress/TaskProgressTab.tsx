import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Circle, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ErrorState, LoadingState } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { formatNumber } from "@/lib/intl";
import { withOccurrenceKeys } from "@/lib/occurrence-keys";
import {
  cancelResearchTaskRun,
  type PlanItem,
  progressResearchTask,
  researchTaskRunLog,
  type ResearchTask,
  type RunRecord,
  type TaskProgress,
  type TodoItem,
} from "@/lib/research-tasks";
import { durationLabel } from "../brief/BriefFields";
import { relativeTime, runStateLabel } from "../task-status";
import { Sparkline } from "./Sparkline";

const POLL_EVERY_MS = 3_000;
const LEDGER_ROWS = 50;

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
  const digits = value < 10 ? 2 : 0;
  return formatNumber(value, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function keyedPlan(items: PlanItem[]): Array<PlanItem & { key: string }> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const count = seen.get(item.text) ?? 0;
    seen.set(item.text, count + 1);
    return { ...item, key: `plan-${item.text}-${count}` };
  });
}

function TodoIcon({ status }: Readonly<{ status: TodoItem["status"] }>) {
  if (status === "completed") return <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0" />;
  if (status === "in_progress") return <CircleDot aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />;
  return <Circle aria-hidden className="mt-0.5 size-3.5 shrink-0" />;
}

export function TaskProgressTab({ task }: Readonly<{ task: ResearchTask }>) {
  const { t } = useTranslation(["common", "researchTools"]);
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<{ runId: string; text: string } | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [confirmRun, setConfirmRun] = useState<RunRecord | null>(null);
  const running = task.status === "running";
  const loadRequest = useRef(0);
  const loading = useRef(false);
  const openLog = useRef<string | null>(null);

  const readLog = useCallback(
    async (runId: string) => {
      try {
        const text = await researchTaskRunLog(task.id, runId);
        if (openLog.current === runId) setLog({ runId, text });
      } catch (cause) {
        setError(describeError(cause));
      }
    },
    [task.id],
  );

  const load = useCallback(
    async (poll = false) => {
      if (poll && loading.current) return;
      const request = ++loadRequest.current;
      loading.current = true;
      try {
        const next = await progressResearchTask(task.id);
        if (request !== loadRequest.current) return;
        setProgress(next);
        setError(null);
        const logged = openLog.current;
        if (logged && next.runsInFlight.some((live) => live.runId === logged)) void readLog(logged);
      } catch (cause) {
        if (request === loadRequest.current) setError(describeError(cause));
      } finally {
        if (request === loadRequest.current) loading.current = false;
      }
    },
    [task.id, readLog],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: a task update means new progress to show
  useEffect(() => {
    void load();
  }, [load, task.updatedAt]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, POLL_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [load, running]);

  const viewLog = async (run: RunRecord) => {
    openLog.current = run.runId;
    await readLog(run.runId);
  };

  const stopRun = async (run: RunRecord) => {
    setConfirmRun(null);
    setStopping(run.runId);
    try {
      await cancelResearchTaskRun(task.id, run.runId);
      await load();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setStopping(null);
    }
  };

  if (!progress) {
    return error ? (
      <ErrorState message={error}>
        <Button size="xs" variant="outline" onClick={() => void load()}>
          {t(($) => $.common.actions.retry)}
        </Button>
      </ErrorState>
    ) : (
      <LoadingState size="compact" label={t(($) => $.researchTools.tasks.progress.loading)} />
    );
  }

  const { budget, best } = progress;
  const finishedRuns = progress.recentRuns
    .filter((run) => !progress.runsInFlight.some((live) => live.runId === run.runId))
    .slice(0, 8);
  const planRows = keyedPlan(progress.plan);
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
                  onClick={() => setConfirmRun(run)}
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
                <Button size="xs" variant="link" className="h-auto p-0" onClick={() => void viewLog(run)}>
                  {t(($) => $.researchTools.tasks.progress.viewLog)}
                </Button>
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
            {planRows.map((item) => (
              <li key={item.key} className="flex items-start gap-2">
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
                <TodoIcon status={todo.status} />
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
        {progress.ledger.length >= LEDGER_ROWS ? (
          <p className="text-xs text-muted-foreground">
            {t(($) => $.researchTools.tasks.progress.ledgerCapped, { limit: formatNumber(LEDGER_ROWS) })}
          </p>
        ) : null}
        {progress.ledger.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t(($) => $.researchTools.tasks.progress.noLedger)}</p>
        ) : (
          <Table containerClassName="rounded-md border" className="min-w-[40rem]">
            <TableHeader>
              <TableRow>
                <TableHead>{t(($) => $.researchTools.tasks.progress.columns.run)}</TableHead>
                <TableHead>{t(($) => $.researchTools.tasks.progress.columns.time)}</TableHead>
                <TableHead>{t(($) => $.researchTools.tasks.progress.columns.hypothesis)}</TableHead>
                <TableHead>{t(($) => $.researchTools.tasks.progress.columns.change)}</TableHead>
                <TableHead>{t(($) => $.researchTools.tasks.progress.columns.metrics)}</TableHead>
                <TableHead>{t(($) => $.researchTools.tasks.progress.columns.verdict)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {withOccurrenceKeys(progress.ledger, (row) => row.id).map(({ item: row, key }) => (
                <TableRow key={key} className="align-top">
                  <TableCell className="align-top font-mono">{row.id}</TableCell>
                  <TableCell className="whitespace-nowrap align-top tabular-nums text-muted-foreground">
                    {row.time}
                  </TableCell>
                  <TableCell className="align-top">{row.hypothesis}</TableCell>
                  <TableCell className="align-top">{row.change}</TableCell>
                  <TableCell className="align-top font-mono">{metricsText(row.metrics)}</TableCell>
                  <TableCell className="align-top">{verdictLabel(row.verdict)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <ConfirmationDialog
        open={confirmRun !== null}
        destructive
        title={t(($) => $.researchTools.tasks.progress.stopRunTitle)}
        description={t(($) => $.researchTools.tasks.progress.stopRunDescription, {
          name: confirmRun?.name ?? "",
          run: confirmRun?.runId ?? "",
        })}
        confirmLabel={t(($) => $.researchTools.tasks.progress.stopRun)}
        cancelLabel={t(($) => $.researchTools.tasks.progress.keepRun)}
        onConfirm={() => {
          if (confirmRun) void stopRun(confirmRun);
        }}
        onCancel={() => setConfirmRun(null)}
      />
    </div>
  );
}
