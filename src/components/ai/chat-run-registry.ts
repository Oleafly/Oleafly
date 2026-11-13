import type { ToolApprovalRequest } from "@/lib/ai-tools";
import type { ApprovalMode } from "@oleafly/ai-tools";

export const WORKSPACE_ASSISTANT_SCOPE = "workspace";

export interface RegisteredApproval {
  req: ToolApprovalRequest;
  resolve: (ok: boolean) => void;
  mode: ApprovalMode;
}

export interface ActiveChatRun {
  scope: string;
  controller: AbortController;
  projectId: string | null;
  chatId: string | null;
  pendingApproval: RegisteredApproval | null;
  lastPartAt: number;
}

const active = new Map<string, ActiveChatRun>();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of [...listeners]) fn();
}

export function beginChatRun(
  controller: AbortController,
  projectId: string | null,
  scope: string = WORKSPACE_ASSISTANT_SCOPE,
): ActiveChatRun {
  const run: ActiveChatRun = {
    scope,
    controller,
    projectId,
    chatId: null,
    pendingApproval: null,
    lastPartAt: Date.now(),
  };
  active.set(scope, run);
  emit();
  return run;
}

export function updateChatRun(
  run: ActiveChatRun,
  patch: Partial<Pick<ActiveChatRun, "chatId" | "pendingApproval" | "lastPartAt">>,
): void {
  if (active.get(run.scope) !== run) return;
  Object.assign(run, patch);
  emit();
}

export function endChatRun(run: ActiveChatRun): void {
  if (active.get(run.scope) !== run) return;
  active.delete(run.scope);
  emit();
}

export function activeChatRun(scope: string = WORKSPACE_ASSISTANT_SCOPE): ActiveChatRun | null {
  return active.get(scope) ?? null;
}

export function activeChatRuns(): ActiveChatRun[] {
  return [...active.values()];
}

export function projectHasChatRun(projectId: string): boolean {
  for (const run of active.values()) if (run.projectId === projectId) return true;
  return false;
}

export function subscribeChatRun(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
