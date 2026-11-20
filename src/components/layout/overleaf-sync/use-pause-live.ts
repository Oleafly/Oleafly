import { useState } from "react";
import { overleafLiveActions } from "@/lib/collab-live-bridge";
import { notifyError } from "@/lib/toast";

export function resumeLive(projectId: string): void {
  overleafLiveActions()
    .resume(projectId)
    .catch((error: unknown) => notifyError("resume overleaf live editing", error));
}

export function usePauseLive(paused: () => void = () => undefined) {
  const [unsent, setUnsent] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const pause = async (projectId: string, anyway = false) => {
    setBusy(true);
    try {
      const outcome = await overleafLiveActions().pause(projectId, anyway);
      setUnsent(outcome.paused ? [] : outcome.unsent);
      if (outcome.paused) paused();
    } catch (error) {
      notifyError("pause overleaf live editing", error);
    } finally {
      setBusy(false);
    }
  };
  return { unsent, busy, pause, keepLive: () => setUnsent([]) };
}
