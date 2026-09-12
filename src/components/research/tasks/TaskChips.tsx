import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { AgentLogo } from "@/components/ai/acp/AgentLogo";
import { ProviderLogo } from "@/components/ai/ProviderLogo";
import { cn } from "@/lib/utils";
import type { ResearchTask, ResearchTaskStatus } from "@/lib/research-tasks";
import { STATUS_ICONS, statusBadgeClass, statusLabel } from "./task-status";

export function TaskStatusBadge({
  status,
  className,
}: {
  status: ResearchTaskStatus;
  className?: string;
}) {
  useTranslation(["common", "researchTools"]);
  const Icon = STATUS_ICONS[status];
  return (
    <Badge variant="outline" className={cn("gap-1", statusBadgeClass(status), className)}>
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
}: {
  task: Pick<ResearchTask, "runtimeId" | "agentId" | "modelId">;
  agentName?: string;
  modelName?: string;
  showAgent?: boolean;
  className?: string;
}) {
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
