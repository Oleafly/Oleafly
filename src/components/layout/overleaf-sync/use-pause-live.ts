import { useState } from "react";
import { overleafLiveActions } from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";

export function usePauseLive(paused: () => void = () => undefined) {
  const [unsent, setUnsent] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const pause = async (projectId: string, anyway = false) => {
    const actions = overleafLiveActions();
    if (!actions) return;
    setBusy(true);
    try {
      const outcome = await actions.pause(projectId, anyway);
      setUnsent(outcome.paused ? [] : outcome.unsent);
      if (outcome.paused) paused();
    } catch (error) {
      void logError("pause overleaf live editing", error);
    } finally {
      setBusy(false);
    }
  };
  return { unsent, busy, pause, keepLive: () => setUnsent([]) };
}
