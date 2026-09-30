import { useSyncExternalStore } from "react";
import { activeChatRun, subscribeChatRun } from "@/components/ai/chat-run-registry";
import { useAcpSessionsStore } from "@/store/acp-sessions";

/**
 * True while any agent turn is running in the project: a CLI agent session
 * that is answering or stopping, or a built-in assistant run. Undo waits for
 * these, because the files may still be changing. Background research tasks
 * work in their own copy of the project, so they do not count.
 */
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
