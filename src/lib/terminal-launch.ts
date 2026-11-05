import { i18n } from "@/i18n";
import { decodeAppError, describeError } from "@/lib/app-error";
import { openExternalTerminal } from "@/lib/terminal-ipc";
import { requestTerminalPrompt, waitForTerminalPromptHost } from "@/lib/terminal-lifecycle";
import { hasControlCharacters, shellCommandLine, type TerminalCommand } from "@/lib/terminal-quote";
import { toast } from "@/lib/toast";
import { isWindows } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useSettingsStore, type ExternalTerminalId } from "@/store/settings";
import { TERMINAL_LIMIT, terminalLimitMessage, useTerminalsStore } from "@/store/terminals";

export interface TerminalLaunch {
  title: string;
  cwd?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  confirmText?: string;
}

export type TerminalLaunchFailure = "no-project" | "tab-limit" | "cancelled" | "invalid";

function failureMessage(reason: TerminalLaunchFailure): string {
  switch (reason) {
    case "invalid":
      return i18n.t(($) => $.workspace.terminal.launch.invalid);
    case "no-project":
      return i18n.t(($) => $.workspace.terminal.launch.noProject);
    case "tab-limit":
      return terminalLimitMessage();
    default:
      return reason;
  }
}

export class TerminalLaunchError extends Error {
  constructor(readonly reason: TerminalLaunchFailure) {
    super(failureMessage(reason));
    this.name = "TerminalLaunchError";
  }
}

const ENV_NAME = /^[A-Za-z_]\w{0,127}$/;
const MAX_ENV = 32;
const MAX_ENV_VALUE_BYTES = 8192;
const PROJECT_FOLDER = /^(?!\/)(?![A-Za-z]:)(?!.*\\)(?!.*(^|\/)\.\.(\/|$)).*$/;

function validate(launch: TerminalLaunch): void {
  const invalid = () => new TerminalLaunchError("invalid");
  if (launch.cwd !== undefined && (!PROJECT_FOLDER.test(launch.cwd) || hasControlCharacters(launch.cwd))) {
    throw invalid();
  }
  const entries = Object.entries(launch.env ?? {});
  if (entries.length > MAX_ENV) throw invalid();
  const encoder = new TextEncoder();
  for (const [name, value] of entries) {
    if (!ENV_NAME.test(name) || name.toUpperCase() === "PATH") throw invalid();
    if (typeof value !== "string" || value.includes("\u0000")) throw invalid();
    if (encoder.encode(value).length > MAX_ENV_VALUE_BYTES) throw invalid();
  }
  for (const part of [launch.command ?? "", ...(launch.args ?? [])]) {
    if (hasControlCharacters(part)) throw invalid();
  }
}

/** A POSIX shell closes a single-quoted string, adds an escaped quote and reopens it. */
const POSIX_ESCAPED_QUOTE = String.raw`'\''`;

function quoted(value: string, windows: boolean): string {
  if (windows) return `'${value.replaceAll(/['‘’‚‛]/g, (quote) => quote + quote)}'`;
  return `'${value.replaceAll("'", POSIX_ESCAPED_QUOTE)}'`;
}

export function launchLine(launch: TerminalLaunch, windows: boolean = isWindows): string {
  validate(launch);
  const env = Object.entries(launch.env ?? {});
  const words = [launch.command ?? "", ...(launch.args ?? [])].filter((word, index) => index > 0 || word);
  if (windows) {
    const prefix = env.map(([name, value]) => `$env:${name}=${quoted(value, true)}; `).join("");
    const command = words.length > 0 ? `& ${words.map((word) => quoted(word, true)).join(" ")}` : "";
    return `${prefix}${command}`.trimEnd();
  }
  const prefix = env.map(([name, value]) => `${name}=${quoted(value, false)} `).join("");
  return `${prefix}${words.map((word) => quoted(word, false)).join(" ")}`.trimEnd();
}

function currentProjectId(): string | null {
  return useTerminalsStore.getState().projectId ?? useFilesStore.getState().projectId ?? null;
}

export function terminalAvailable(): boolean {
  return currentProjectId() !== null;
}

function refuseAtLimit(): never {
  toast.infoUnique("terminal-limit", terminalLimitMessage());
  throw new TerminalLaunchError("tab-limit");
}

const PROMPT_HOST_WAIT_MS = 2000;
const EXTERNAL_FALLBACK = "terminal.external_fallback";

async function openedExternally(
  terminal: ExternalTerminalId,
  projectId: string,
  launch: TerminalLaunch,
  command: TerminalCommand | undefined,
): Promise<boolean> {
  try {
    await openExternalTerminal({ projectId, terminal, cwd: launch.cwd, command, env: launch.env });
    return true;
  } catch (error) {
    if (decodeAppError(error)?.code !== EXTERNAL_FALLBACK) throw error;
    toast.info(describeError(error));
    return false;
  }
}

export async function openTerminalWith(launch: TerminalLaunch): Promise<{ terminalId: string | null }> {
  validate(launch);
  const projectId = currentProjectId();
  if (!projectId) throw new TerminalLaunchError("no-project");
  if (useTerminalsStore.getState().projectId !== projectId) {
    useTerminalsStore.getState().setProject(projectId);
  }
  const { terminalOpenWith } = useSettingsStore.getState();
  if (terminalOpenWith === "builtin" && useTerminalsStore.getState().tabs.length >= TERMINAL_LIMIT) refuseAtLimit();
  const command: TerminalCommand | undefined = launch.command
    ? { command: launch.command, args: [...(launch.args ?? [])] }
    : undefined;
  if (launch.confirmText && command) {
    useSettingsStore.getState().setTerminalOpen(true);
    await waitForTerminalPromptHost(PROMPT_HOST_WAIT_MS);
    const agreed = await requestTerminalPrompt({
      kind: "launch",
      title: launch.title,
      description: launch.confirmText,
      commandLine: shellCommandLine(isWindows ? "powershell" : "posix", command),
    });
    if (!agreed || useTerminalsStore.getState().projectId !== projectId) {
      throw new TerminalLaunchError("cancelled");
    }
  }
  if (terminalOpenWith !== "builtin" && (await openedExternally(terminalOpenWith, projectId, launch, command))) {
    return { terminalId: null };
  }
  const tab = useTerminalsStore.getState().addTerminal({
    title: launch.title,
    cwd: launch.cwd,
    env: launch.env,
    launch: command,
  });
  if (!tab) refuseAtLimit();
  useSettingsStore.getState().setTerminalOpen(true);
  return { terminalId: tab.id };
}
