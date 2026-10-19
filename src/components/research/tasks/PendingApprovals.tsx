import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { i18n } from "@/i18n";
import { formatDateTime } from "@/lib/intl";
import {
  decideResearchTaskApproval,
  listResearchTaskApprovals,
  type ApprovalKind,
  type ApprovalRecord,
  type ResearchTask,
} from "@/lib/research-tasks";
import { cn } from "@/lib/utils";
import { useResearchAttentionStore } from "@/store/research-attention";

function kindLabel(kind: ApprovalKind): string {
  switch (kind) {
    case "command":
      return i18n.t(($) => $.researchTools.tasks.approvals.kindCommand);
    case "run":
      return i18n.t(($) => $.researchTools.tasks.approvals.kindRun);
    case "mcp":
      return i18n.t(($) => $.researchTools.tasks.approvals.kindMcp);
  }
}

interface PendingApprovalsProps {
  projectId: string;
  tasks: ResearchTask[];
  /** Only this task's requests (the task detail banner). */
  taskId?: string;
}

/** Requests from unattended tasks that wait for the user. Renders nothing when none wait. */
export function PendingApprovals({ projectId, tasks, taskId }: Readonly<PendingApprovalsProps>) {
  const { t } = useTranslation(["researchTools"]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attention = useResearchAttentionStore((state) => state.byProject[projectId] ?? 0);
  const waiting = tasks.reduce((total, task) => total + task.pendingApprovals, 0);

  const load = useCallback(async () => {
    try {
      setApprovals(await listResearchTaskApprovals(projectId));
    } catch {
      setApprovals([]);
    }
  }, [projectId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attention and task counts signal new or answered requests
  useEffect(() => {
    void load();
  }, [load, attention, waiting]);

  const decide = async (approval: ApprovalRecord, approve: boolean) => {
    setDeciding(approval.id);
    setError(null);
    try {
      await decideResearchTaskApproval(approval.id, approve);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeciding(null);
      void load();
    }
  };

  const shown = approvals.filter((approval) => !taskId || approval.taskId === taskId);
  if (shown.length === 0) return null;

  return (
    <section
      aria-labelledby="research-pending-approvals"
      className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3"
      data-testid="research-pending-approvals"
    >
      <h4 id="research-pending-approvals" className="flex items-center gap-2 text-sm font-medium">
        <ShieldQuestion aria-hidden className="size-4" />
        {t(($) => $.researchTools.tasks.approvals.title)}
      </h4>
      <ul className="space-y-2">
        {shown.map((approval) => {
          const task = tasks.find((candidate) => candidate.id === approval.taskId);
          const open = expanded === approval.id;
          return (
            <li key={approval.id} className="space-y-1.5 rounded-md border bg-background p-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="font-medium">{kindLabel(approval.kind)}</span>
                {task && !taskId ? <span className="truncate text-muted-foreground">{task.title}</span> : null}
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {t(($) => $.researchTools.tasks.approvals.expires, {
                    time: formatDateTime(new Date(approval.expiresAt)),
                  })}
                </span>
              </div>
              <p className="text-sm">{approval.summary}</p>
              {approval.detail ? (
                <button
                  type="button"
                  className="block w-full rounded text-left hover:bg-muted/60"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : approval.id)}
                >
                  <pre
                    className={cn(
                      "select-text whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-xs",
                      !open && "line-clamp-3",
                    )}
                  >
                    {approval.detail}
                  </pre>
                </button>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={deciding === approval.id}
                  onClick={() => void decide(approval, false)}
                >
                  {t(($) => $.researchTools.tasks.approvals.deny)}
                </Button>
                <Button size="xs" disabled={deciding === approval.id} onClick={() => void decide(approval, true)}>
                  {t(($) => $.researchTools.tasks.approvals.approve)}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="select-text text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
