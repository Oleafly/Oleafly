// Opening a terminal tab that runs one command (contract C-5): a sign-in, an
// installer, a folder from the file tree. The tab's shell starts in the
// folder with the extra environment, then the command is typed into it,
// quoted for the shell that actually started.
import { i18n } from "@/i18n";
import { requestTerminalPrompt, waitForTerminalPromptHost } from "@/lib/terminal-lifecycle";
import { hasControlCharacters, shellCommandLine, type TerminalCommand } from "@/lib/terminal-quote";
import { toast } from "@/lib/toast";
import { isWindows } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { TERMINAL_LIMIT, terminalLimitMessage, useTerminalsStore } from "@/store/terminals";

export interface TerminalLaunch {
  /** The tab's title. */
  title: string;
  /** Project-relative folder with `/` separators; the project root when empty or left out. */
  cwd?: string;
  /** Typed into the shell, so it lands in the shell's history: never a secret. */
  command?: string;
  args?: string[];
  /** Set on the shell's environment, not typed. Never `PATH`. */
  env?: Record<string, string>;
  /** When set, the user sees the command and this text and must agree first. */
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
/** Bytes, as the shell's environment counts them. */
const MAX_ENV_VALUE_BYTES = 8192;
/** Relative, no drive, no backslash, no `..` segment. */
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

/**
 * The launch as one line to copy and paste: PowerShell on Windows
 * (`$env:NAME='v'; & 'cmd' 'arg'`), a POSIX shell elsewhere
 * (`NAME='v' 'cmd' 'arg'`). Every word is quoted. Throws `invalid` like
 * `openTerminalWith`.
 */
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

/** Whether a terminal can be opened now (a project is open). */
export function terminalAvailable(): boolean {
  return currentProjectId() !== null;
}

function refuseAtLimit(): never {
  toast.infoUnique("terminal-limit", terminalLimitMessage());
  throw new TerminalLaunchError("tab-limit");
}

/** How long a confirmation waits for the dock to mount its prompt host. */
const PROMPT_HOST_WAIT_MS = 2000;

/**
 * Opens a project terminal tab for the launch and shows the dock. With
 * `confirmText` the user sees the command first; a no rejects with
 * `cancelled` and adds nothing.
 */
export async function openTerminalWith(launch: TerminalLaunch): Promise<{ terminalId: string }> {
  validate(launch);
  const projectId = currentProjectId();
  if (!projectId) throw new TerminalLaunchError("no-project");
  if (useTerminalsStore.getState().projectId !== projectId) {
    useTerminalsStore.getState().setProject(projectId);
  }
  if (useTerminalsStore.getState().tabs.length >= TERMINAL_LIMIT) refuseAtLimit();
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
    // A project switch while the question was up leaves nothing to run in.
    if (!agreed || useTerminalsStore.getState().projectId !== projectId) {
      throw new TerminalLaunchError("cancelled");
    }
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
