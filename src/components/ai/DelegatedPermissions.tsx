import { useEffect, useMemo } from "react";
import { PermissionCard } from "@/components/ai/acp/PermissionCard";
import { acpDelegatedPermission, acpError, type AcpPermission } from "@/lib/acp";
import { attachAcpListeners, useAcpSessionsStore } from "@/store/acp-sessions";
import type { SubagentEntry } from "@/store/chats";

const EMPTY_PERMISSIONS: Record<string, AcpPermission[]> = {};

export function delegatedAcpSessions(
  subagents: readonly SubagentEntry[] | undefined,
): { sessionId: string; agentId?: string }[] {
  const bySession = new Map<string, { sessionId: string; agentId?: string }>();
  for (const entry of subagents ?? []) {
    if (entry.runtime !== "acp" || !entry.sessionId) continue;
    bySession.set(entry.sessionId, { sessionId: entry.sessionId, agentId: entry.agentId });
  }
  return [...bySession.values()];
}

export function DelegatedPermissions({
  projectId,
  parentSessionId,
  subagents,
  onError,
}: Readonly<{
  projectId: string | null;
  parentSessionId: string | null | undefined;
  subagents: readonly SubagentEntry[] | undefined;
  onError?: (message: string) => void;
}>) {
  const children = useMemo(() => delegatedAcpSessions(subagents), [subagents]);
  const listening = children.length > 0;
  const permissionsBySession = useAcpSessionsStore((state) =>
    listening ? state.permissions : EMPTY_PERMISSIONS,
  );

  useEffect(() => {
    if (!listening) return;
    let disposed = false;
    let detach: (() => void) | undefined;
    void attachAcpListeners()
      .then((stop) => {
        if (disposed) stop();
        else detach = stop;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      detach?.();
    };
  }, [listening]);

  const pending = useMemo(
    () =>
      children.flatMap((child) =>
        (permissionsBySession[child.sessionId] ?? []).map((request) => ({ child, request })),
      ),
    [children, permissionsBySession],
  );

  if (!projectId || !parentSessionId || pending.length === 0) return null;

  const answer = async (sessionId: string, permissionId: string, optionId: string | null) => {
    try {
      await acpDelegatedPermission(
        projectId,
        sessionId,
        parentSessionId,
        permissionId,
        optionId,
      );
    } catch (error) {
      onError?.(acpError(error));
    }
  };

  return (
    <div
      data-testid="delegated-permissions"
      className="max-h-64 space-y-2 overflow-y-auto px-3 pb-1 pt-2"
    >
      {pending.map(({ child, request }) => (
        <PermissionCard
          key={`${child.sessionId}:${request.id}`}
          request={request}
          agentName={child.agentId}
          onChoose={(permissionId, optionId) =>
            answer(child.sessionId, permissionId, optionId)
          }
        />
      ))}
    </div>
  );
}
