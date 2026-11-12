import { useCallback, useEffect, useRef, useState } from "react";
import { currentModeId, groupControls, modeChoices, type ModeControl } from "@/components/ai/acp/acp-controls";
import { acpAgentPreferences, acpSetAgentPreference, acpSetConfigOption, acpSetMode, type AcpSession } from "@/lib/acp";
import { logError } from "@/lib/log";
import { setAcpPromptGate, useAcpSessionsStore } from "@/store/acp-sessions";

export const READ_ONLY_MODES: readonly string[] = ["read-only", "readonly", "read_only", "plan"];
export const SETTLE_MS = 300;
const MAX_TRIES = 3;

type Controls = AcpSession["controls"];
type SessionsState = ReturnType<typeof useAcpSessionsStore.getState>;

export interface ReadOnlyChoice {
  mode: ModeControl;
  value: string;
}

export function readOnlyChoice(controls: Controls | undefined): ReadOnlyChoice | null {
  if (!controls) return null;
  const mode = groupControls(controls).mode;
  if (!mode) return null;
  const offered = modeChoices(mode).filter((choice) => !choice.blocked);
  const value = READ_ONLY_MODES.find((id) => offered.some((choice) => choice.id === id));
  return value ? { mode, value } : null;
}

export function isReadOnly(controls: Controls | undefined): boolean {
  if (!controls) return false;
  const mode = groupControls(controls).mode;
  const current = mode ? currentModeId(mode) : null;
  return current !== null && READ_ONLY_MODES.includes(current);
}

async function switchToReading(projectId: string, session: AcpSession, choice: ReadOnlyChoice): Promise<boolean> {
  const previous = (await acpAgentPreferences(session.agentId)).mode;
  const snapshot =
    choice.mode.kind === "config"
      ? await acpSetConfigOption(projectId, session.id, choice.mode.option.id, choice.value)
      : await acpSetMode(projectId, session.id, choice.value);
  useAcpSessionsStore.getState().setSnapshot(snapshot);
  await acpSetAgentPreference(session.agentId, "mode", previous);
  return true;
}

const switching = new Map<string, Promise<boolean>>();

export function holdToReading(projectId: string, session: AcpSession): Promise<boolean> {
  const choice = readOnlyChoice(session.controls);
  if (!choice) return Promise.resolve(false);
  const running = switching.get(session.id);
  if (running) return running;
  const next = switchToReading(projectId, session, choice).finally(() => switching.delete(session.id));
  switching.set(session.id, next);
  return next;
}

function idleSession(state: SessionsState, slot: string): AcpSession | undefined {
  const id = state.activeByProject[slot];
  const session = id ? state.sessions[id] : undefined;
  if (session?.status !== "ready" || isReadOnly(session.controls) || !readOnlyChoice(session.controls)) {
    return undefined;
  }
  if ((state.queues[session.id]?.length ?? 0) > 0 || state.sending[session.id]) return undefined;
  return session;
}

export function useNoteAcpReadOnly(projectId: string, slot: string, enabled: boolean): boolean {
  const readOnly = useAcpSessionsStore((state) => {
    const id = state.activeByProject[slot];
    const session = id ? state.sessions[id] : undefined;
    return session ? isReadOnly(session.controls) : false;
  });
  useEffect(() => {
    if (!enabled) return;
    const tries = new Map<string, number>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      const session = idleSession(useAcpSessionsStore.getState(), slot);
      if (!session) return;
      const tried = tries.get(session.id) ?? 0;
      if (tried >= MAX_TRIES) return;
      tries.set(session.id, tried + 1);
      void holdToReading(projectId, session).catch((error: unknown) => logError("keep the note's agent to reading", error));
    };
    const check = () => {
      clearTimeout(timer);
      if (idleSession(useAcpSessionsStore.getState(), slot)) timer = setTimeout(attempt, SETTLE_MS);
    };
    check();
    const stop = useAcpSessionsStore.subscribe(check);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [enabled, projectId, slot]);
  return enabled && readOnly;
}

async function readingOnly(projectId: string, session: AcpSession): Promise<boolean> {
  if (isReadOnly(session.controls)) return true;
  if (!readOnlyChoice(session.controls)) return false;
  try {
    await holdToReading(projectId, session);
  } catch (error) {
    void logError("keep the note's agent to reading", error);
  }
  return isReadOnly(useAcpSessionsStore.getState().sessions[session.id]?.controls);
}

export interface NoteAgentWriteRequest {
  sessionId: string;
  agentId: string;
  allow: () => void;
  decline: () => void;
}

interface Waiting {
  sessionId: string;
  agentId: string;
  answers: ((allowed: boolean) => void)[];
}

export function useNoteAcpWriteGuard(projectId: string, slot: string, enabled: boolean): NoteAgentWriteRequest | null {
  const waitingRef = useRef<Waiting | null>(null);
  const [shown, setShown] = useState<{ sessionId: string; agentId: string } | null>(null);
  const settle = useCallback((allowed: boolean) => {
    const waiting = waitingRef.current;
    waitingRef.current = null;
    setShown(null);
    if (!waiting) return;
    for (const reply of waiting.answers) reply(allowed);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const ask = (session: AcpSession) =>
      new Promise<boolean>((resolve) => {
        const waiting = waitingRef.current;
        if (waiting?.sessionId === session.id) {
          waiting.answers.push(resolve);
          return;
        }
        for (const reply of waiting?.answers ?? []) reply(false);
        waitingRef.current = { sessionId: session.id, agentId: session.agentId, answers: [resolve] };
        setShown({ sessionId: session.id, agentId: session.agentId });
      });
    const stop = setAcpPromptGate(slot, async (session) => (await readingOnly(projectId, session)) || ask(session));
    return () => {
      stop();
      settle(false);
    };
  }, [enabled, projectId, settle, slot]);
  if (!shown) return null;
  return { ...shown, allow: () => settle(true), decline: () => settle(false) };
}
