import { useCallback, useEffect, useRef, useState } from "react";
import {
  acpAgentPreferences,
  acpError,
  acpSetAgentPreference,
  type AcpAgentPreferences,
  type AcpPreferences,
  type AcpRememberedChoice,
} from "@/lib/acp";

export const ACP_PREFERENCES_CHANGED = "oleafly:acp-preferences-changed";

export function announceAcpPreferences(prefs: AcpPreferences) {
  window.dispatchEvent(new CustomEvent<AcpPreferences>(ACP_PREFERENCES_CHANGED, { detail: prefs }));
}

export type AgentPreferenceSlot = "effort" | "mode" | "provider";

export interface AgentPreferences {
  prefs: AcpAgentPreferences | null;
  loadError: string | null;
  save(slot: AgentPreferenceSlot, value: AcpRememberedChoice | string | null): Promise<string | null>;
}

export function useAgentPreferences(agentId: string): AgentPreferences {
  const [prefs, setPrefs] = useState<AcpAgentPreferences | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const live = useRef(true);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    live.current = true;
    setPrefs(null);
    setLoadError(null);
    acpAgentPreferences(agentId)
      .then((value) => { if (live.current) setPrefs(value); })
      .catch((error: unknown) => { if (live.current) setLoadError(acpError(error)); });
    return () => { live.current = false; };
  }, [agentId]);

  const save = useCallback<AgentPreferences["save"]>(
    (slot, value) => {
      const run = queue.current.then(async () => {
        try {
          const stored = await acpSetAgentPreference(agentId, slot, value);
          if (live.current) setPrefs(stored);
          return null;
        } catch (error) {
          try {
            const stored = await acpAgentPreferences(agentId);
            if (live.current) setPrefs(stored);
          } catch {
            // The card keeps what it showed.
          }
          return acpError(error);
        }
      });
      queue.current = run;
      return run;
    },
    [agentId],
  );

  return { prefs, loadError, save };
}
