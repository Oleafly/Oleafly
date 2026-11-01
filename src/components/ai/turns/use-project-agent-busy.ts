import { useSyncExternalStore } from "react";
import { activeChatRun, subscribeChatRun } from "@/components/ai/chat-run-registry";
import { useAcpSessionsStore } from "@/store/acp-sessions";

export function useProjectAgentBusy(projectId: string): boolean {
  const cliBusy = useAcpSessionsStore((state) =>
    Object.values(state.sessions ?? {}).some(
      (session) =>
        session.projectId === projectId &&
        !session.taskId &&
        (session.status === "running" || session.status === "cancelling"),
    ),
  );
  const builtInBusy = useSyncExternalStore(
    subscribeChatRun,
    () => activeChatRun()?.projectId === projectId,
    () => false,
  );
  return cliBusy || builtInBusy;
}
