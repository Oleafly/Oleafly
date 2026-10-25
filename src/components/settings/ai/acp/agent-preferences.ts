import { useCallback, useEffect, useRef, useState } from "react";
import {
  acpAgentPreferences,
  acpError,
  acpSetAgentPreference,
  type AcpAgentPreferences,
  type AcpPreferences,
  type AcpRememberedChoice,
} from "@/lib/acp";

/** Fired on `window` after Settings saves the agent preferences; `detail` is the stored `AcpPreferences`. */
export const ACP_PREFERENCES_CHANGED = "oleafly:acp-preferences-changed";

export function announceAcpPreferences(prefs: AcpPreferences) {
  window.dispatchEvent(new CustomEvent<AcpPreferences>(ACP_PREFERENCES_CHANGED, { detail: prefs }));
}

export type AgentPreferenceSlot = "effort" | "mode" | "provider";

/** One agent's remembered choices, shared by every section of its card. */
export interface AgentPreferences {
  prefs: AcpAgentPreferences | null;
  loadError: string | null;
  /** Saves one choice and keeps the others as stored. Resolves with the error to show, or null. */
  save(slot: AgentPreferenceSlot, value: AcpRememberedChoice | string | null): Promise<string | null>;
}

export function useAgentPreferences(agentId: string): AgentPreferences {
  const [prefs, setPrefs] = useState<AcpAgentPreferences | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const live = useRef(true);
  // One save at a time, so each answer already holds every earlier change.
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
          // Show what is stored, not what this card assumed.
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
