import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { ErrorState } from "@/components/ui/empty";
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { formatDateTime } from "@/lib/intl";
import {
  decideResearchTaskApproval,
  listResearchTaskApprovals,
  type ApprovalKind,
  type ApprovalRecord,
  type ResearchTask,
} from "@/lib/research-tasks";
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

function detailLabel(kind: ApprovalKind): string {
  switch (kind) {
    case "command":
      return i18n.t(($) => $.researchTools.tasks.approvals.detailCommand);
    case "run":
      return i18n.t(($) => $.researchTools.tasks.approvals.detailRun);
    case "mcp":
      return i18n.t(($) => $.researchTools.tasks.approvals.detailMcp);
  }
}

interface PendingApprovalsProps {
  projectId: string;
  tasks: ResearchTask[];
  taskId?: string;
}

export function PendingApprovals({ projectId, tasks, taskId }: Readonly<PendingApprovalsProps>) {
  const { t } = useTranslation(["common", "researchTools"]);
  const headingId = useId();
  const [loaded, setLoaded] = useState<{ projectId: string; approvals: ApprovalRecord[] } | null>(null);
  const [failedProject, setFailedProject] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRequest = useRef(0);
  const attention = useResearchAttentionStore((state) => state.byProject[projectId] ?? 0);
  const waiting = tasks.reduce((total, task) => total + task.pendingApprovals, 0);

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    try {
      const next = await listResearchTaskApprovals(projectId);
      if (request !== loadRequest.current) return;
      setLoaded({ projectId, approvals: next });
      setFailedProject(null);
    } catch {
      if (request === loadRequest.current) setFailedProject(projectId);
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
      setLoaded((current) =>
        current ? { ...current, approvals: current.approvals.filter((candidate) => candidate.id !== approval.id) } : current,
      );
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setDeciding(null);
      void load();
    }
  };

  const approvals = loaded?.projectId === projectId ? loaded.approvals : [];
  const shown = approvals.filter((approval) => !taskId || approval.taskId === taskId);
  const unreadable = failedProject === projectId && (shown.length > 0 || waiting > 0 || attention > 0);
  if (shown.length === 0 && !unreadable) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3"
      data-testid="research-pending-approvals"
    >
      <h4 id={headingId} className="flex items-center gap-2 text-sm font-medium">
        <ShieldQuestion aria-hidden className="size-4" />
        {t(($) => $.researchTools.tasks.approvals.title)}
      </h4>
      {unreadable ? (
        <ErrorState size="compact" message={t(($) => $.researchTools.tasks.approvals.loadFailed)}>
          <Button size="xs" variant="outline" onClick={() => void load()}>
            {t(($) => $.common.actions.retry)}
          </Button>
        </ErrorState>
      ) : null}
      <ul className="space-y-2">
        {shown.map((approval) => {
          const task = tasks.find((candidate) => candidate.id === approval.taskId);
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
                <div className="space-y-1">
                  <p className="text-[0.6875rem] font-medium text-muted-foreground">
                    {detailLabel(approval.kind)}
                  </p>
                  <CodeBlock
                    code={approval.detail}
                    tabIndex={0}
                    aria-label={detailLabel(approval.kind)}
                    preClassName="max-h-48 whitespace-pre-wrap break-all text-xs focus-visible:border-ring"
                  />
                </div>
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
