import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { AgentLogo } from "@/components/ai/acp/AgentLogo";
import { ProviderLogo } from "@/components/ai/ProviderLogo";
import { cn } from "@/lib/utils";
import type { ResearchTask, ResearchTaskStatus } from "@/lib/research-tasks";
import { STATUS_ICONS, statusBadgeVariant, statusLabel } from "./task-status";

export function TaskStatusBadge({
  status,
  className,
}: Readonly<{
  status: ResearchTaskStatus;
  className?: string;
}>) {
  useTranslation(["common", "researchTools"]);
  const Icon = STATUS_ICONS[status];
  return (
    <Badge variant={statusBadgeVariant(status)} className={cn("gap-1", className)}>
      <Icon
        aria-hidden="true"
        className={cn("size-3", status === "running" && "animate-spin motion-reduce:animate-none")}
      />
      {statusLabel(status)}
    </Badge>
  );
}

export function TaskAgentChip({
  task,
  agentName,
  modelName,
  showAgent = false,
  className,
}: Readonly<{
  task: Pick<ResearchTask, "runtimeId" | "agentId" | "modelId">;
  agentName?: string;
  modelName?: string;
  showAgent?: boolean;
  className?: string;
}>) {
  const agent = agentName?.trim() || task.agentId;
  const model = modelName?.trim() || task.modelId || null;
  const primary = showAgent ? agent : (model ?? agent);
  const secondary = showAgent ? model : null;
  return (
    <span
      data-testid="task-agent-chip"
      title={secondary ? `${primary} · ${secondary}` : primary}
      className={cn("flex min-w-0 items-center gap-1.5", className)}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {task.runtimeId === "acp" ? (
          <AgentLogo agentId={task.agentId} size={14} />
        ) : (
          <ProviderLogo providerId={task.agentId} size={14} />
        )}
      </span>
      <span className="min-w-0 truncate text-xs font-medium text-foreground">{primary}</span>
      {secondary ? (
        <span className="min-w-0 truncate text-xs text-muted-foreground">{secondary}</span>
      ) : null}
    </span>
  );
}

// 0.4.8 L: work the background helper runs after Oleafly quits.

export type OwnerBadgeState = "background" | "movingBack" | null;

type OwnerFields = Pick<ResearchTask, "owner" | "status" | "reclaimRequested">;

/** "Moving back" while Oleafly waits for the helper to return the task;
 * "In background" while the helper runs it or will start it. */
export function ownerBadgeState(task: OwnerFields): OwnerBadgeState {
  if (task.reclaimRequested) return "movingBack";
  if (task.owner === "daemon" && (task.status === "running" || task.status === "queued")) return "background";
  return null;
}

export function TaskOwnerBadge({
  task,
  className,
}: Readonly<{
  task: OwnerFields;
  className?: string;
}>) {
  const { t } = useTranslation(["researchTools"]);
  const state = ownerBadgeState(task);
  if (!state) return null;
  const moving = state === "movingBack";
  return (
    <Tooltip
      label={
        moving
          ? t(($) => $.researchTools.backgroundHelper.badge.movingBackHint)
          : t(($) => $.researchTools.backgroundHelper.badge.backgroundHint)
      }
      className={cn("inline-flex", className)}
    >
      <Badge variant="info" size="sm" data-testid="task-owner-badge" data-state={state}>
        {moving
          ? t(($) => $.researchTools.backgroundHelper.badge.movingBack)
          : t(($) => $.researchTools.backgroundHelper.badge.background)}
      </Badge>
    </Tooltip>
  );
}
