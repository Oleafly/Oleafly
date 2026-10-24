// Asking before a running program is stopped (closing a terminal tab, the
// project or the app) and before Oleafly types a prepared command into a
// terminal. One promise-based prompt store; TerminalPrompts renders it.
import { create } from "zustand";
import { terminalJobs } from "@/lib/terminal-sessions";
import { useFolderAccessStore } from "@/store/folder-access";
import { useSettingsStore } from "@/store/settings";
import { useTerminalsStore } from "@/store/terminals";

export type TerminalStopReason = "close-tab" | "close-project" | "switch-project" | "quit" | "restart";

export type TerminalPrompt =
  | {
      kind: "stop";
      reason: TerminalStopReason;
      jobs: ReadonlyArray<{ title: string; process: string | null }>;
    }
  | { kind: "launch"; title: string; description: string; commandLine: string };

export type ActiveTerminalPrompt = TerminalPrompt & { id: number };

interface TerminalPromptState {
  prompt: ActiveTerminalPrompt | null;
  answer(id: number, ok: boolean): void;
}

/** A confirmed close or switch stands for this long, so one leave asks once. */
const CONFIRMED_LEAVE_MS = 60_000;

let nextPromptId = 1;
let hosts = 0;
const resolvers = new Map<number, (ok: boolean) => void>();
const hostWaiters = new Set<() => void>();
const confirmedLeaves = new Map<string, number>();

/** The answer when nobody can be asked: never block a stop, never run a launch. */
function unattendedAnswer(prompt: TerminalPrompt): boolean {
  return prompt.kind === "stop";
}

export const useTerminalPromptStore = create<TerminalPromptState>((set, get) => ({
  prompt: null,
  answer: (id, ok) => {
    const resolve = resolvers.get(id);
    resolvers.delete(id);
    if (get().prompt?.id === id) set({ prompt: null });
    resolve?.(ok);
  },
}));

/** Shows a prompt and resolves with the answer. A newer prompt answers this one with no. */
export function requestTerminalPrompt(prompt: TerminalPrompt): Promise<boolean> {
  if (hosts === 0) return Promise.resolve(unattendedAnswer(prompt));
  const store = useTerminalPromptStore.getState();
  if (store.prompt) store.answer(store.prompt.id, false);
  const id = nextPromptId;
  nextPromptId += 1;
  return new Promise<boolean>((resolve) => {
    resolvers.set(id, resolve);
    useTerminalPromptStore.setState({ prompt: { ...prompt, id } });
  });
}

/** Called by the component that renders prompts while it is mounted. */
export function registerTerminalPromptHost(): () => void {
  hosts += 1;
  for (const wake of hostWaiters) wake();
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    hosts -= 1;
    if (hosts > 0) return;
    const open = useTerminalPromptStore.getState().prompt;
    if (open) useTerminalPromptStore.getState().answer(open.id, unattendedAnswer(open));
  };
}

/** Resolves true once a prompt host is mounted, or false after `timeoutMs`. */
export function waitForTerminalPromptHost(timeoutMs: number): Promise<boolean> {
  if (hosts > 0) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      hostWaiters.delete(wake);
      resolve(true);
    };
    const timer = setTimeout(() => {
      hostWaiters.delete(wake);
      resolve(hosts > 0);
    }, timeoutMs);
    hostWaiters.add(wake);
  });
}

/**
 * Whether the programs running in the project's terminals (all, or
 * `tabIds`) may be stopped. True without asking when asking is off, nothing
 * runs, or the check fails; a confirmed close or switch of the same project
 * is remembered for a minute.
 */
export async function confirmStopTerminals(request: {
  reason: TerminalStopReason;
  projectId?: string;
  tabIds?: readonly string[];
}): Promise<boolean> {
  if (!useSettingsStore.getState().terminalConfirmClose) return true;
  const projectId = request.projectId ?? useTerminalsStore.getState().projectId;
  if (!projectId) return true;
  const leaving = request.reason === "close-project" || request.reason === "switch-project";
  const confirmedAt = confirmedLeaves.get(projectId);
  if (leaving && confirmedAt !== undefined && Date.now() - confirmedAt < CONFIRMED_LEAVE_MS) return true;
  const jobs = await terminalJobs(projectId, request.tabIds).catch(() => []);
  if (jobs.length === 0) return true;
  const tabs = useTerminalsStore.getState().tabs;
  const ok = await requestTerminalPrompt({
    kind: "stop",
    reason: request.reason,
    jobs: jobs.map((job) => ({
      title: tabs.find((tab) => tab.id === job.tabId)?.title ?? job.tabId,
      process: job.process,
    })),
  });
  if (ok && leaving) confirmedLeaves.set(projectId, Date.now());
  return ok;
}

/**
 * Closes the tabs, first asking when a program still runs in one of them.
 * With asking off, `close` runs before this returns.
 */
export function requestCloseTerminals(tabIds: readonly string[], close: () => void): Promise<boolean> {
  if (!useSettingsStore.getState().terminalConfirmClose) {
    close();
    return Promise.resolve(true);
  }
  return confirmStopTerminals({ reason: "close-tab", tabIds }).then((ok) => {
    if (ok) close();
    return ok;
  });
}

/** Closes tabs; hides the dock when none would be left. */
export function closeTerminalTabs(tabIds: readonly string[]): void {
  const closing = new Set(tabIds);
  if (!useTerminalsStore.getState().tabs.some((tab) => !closing.has(tab.id))) {
    useSettingsStore.getState().setTerminalOpen(false);
  }
  for (const id of tabIds) {
    useTerminalsStore.getState().closeTerminal(id);
    useFolderAccessStore.getState().forgetTerminal(id);
  }
}

/** Test helper: forget remembered leaves. */
export function resetTerminalLifecycleForTest(): void {
  confirmedLeaves.clear();
  const open = useTerminalPromptStore.getState().prompt;
  if (open) useTerminalPromptStore.getState().answer(open.id, false);
}
