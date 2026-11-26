import { useState } from "react";
import { overleafLiveActions } from "@/lib/collab-live-bridge";
import { notifyError } from "@/lib/toast";

export function resumeLive(projectId: string): void {
  const actions = overleafLiveActions();
  actions
    .resume(projectId)
    .catch((error: unknown) => notifyError("resume overleaf live editing", error, actions.errorText?.(error)));
}

export function usePauseLive(paused: () => void = () => undefined) {
  const [unsent, setUnsent] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const pause = async (projectId: string, anyway = false) => {
    setBusy(true);
    const actions = overleafLiveActions();
    try {
      const outcome = await actions.pause(projectId, anyway);
      setUnsent(outcome.paused ? [] : outcome.unsent);
      if (outcome.paused) paused();
    } catch (error) {
      notifyError("pause overleaf live editing", error, actions.errorText?.(error));
    } finally {
      setBusy(false);
    }
  };
  return { unsent, busy, pause, keepLive: () => setUnsent([]) };
}
