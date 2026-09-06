import { Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ProviderLogo } from "@/components/ai/ProviderLogo";
import { cn } from "@/lib/utils";
import type { ResearchTask, ResearchTaskStatus } from "@/lib/research-tasks";
import { STATUS_ICONS, STATUS_LABELS, statusBadgeClass } from "./task-status";

export function TaskStatusBadge({
  status,
  className,
}: {
  status: ResearchTaskStatus;
  className?: string;
}) {
  const Icon = STATUS_ICONS[status];
  return (
    <Badge variant="outline" className={cn("gap-1", statusBadgeClass(status), className)}>
      <Icon
        aria-hidden="true"
        className={cn("size-3", status === "running" && "animate-spin motion-reduce:animate-none")}
      />
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function TaskAgentChip({
  task,
  agentName,
  className,
}: {
  task: Pick<ResearchTask, "runtimeId" | "agentId" | "modelId">;
  agentName?: string;
  className?: string;
}) {
  const name = agentName?.trim() || task.agentId;
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <span className="flex size-4 shrink-0 items-center justify-center">
        {task.runtimeId === "acp" ? (
          <Terminal aria-hidden="true" className="size-3.5 text-muted-foreground" />
        ) : (
          <ProviderLogo providerId={task.agentId} size={14} />
        )}
      </span>
      <span className="min-w-0 truncate text-xs font-medium text-foreground">{name}</span>
      {task.modelId ? (
        <span className="min-w-0 truncate text-xs text-muted-foreground">{task.modelId}</span>
      ) : null}
    </span>
  );
}
