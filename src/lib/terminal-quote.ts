// Quoting for the shell a terminal runs: commands Oleafly types for a
// launch and paths dropped from the file tree. Pure string work.
import type { TerminalPlatform } from "./terminal-keys";

export type TerminalShellKind = "posix" | "fish" | "powershell" | "cmd";

export interface TerminalCommand {
  command: string;
  args: readonly string[];
}

/** No `=` (zsh expands a leading `=word`) and no `~`. */
const POSIX_SAFE = /^[A-Za-z0-9_@%+:,./-]+$/;
const POWERSHELL_SAFE = /^[A-Za-z0-9_\-./\\:]+$/;
const CMD_SPECIAL = /[\s&|<>^%"()!,;=]/;
/** PowerShell treats all of these as single quotes; doubling each escapes it. */
const POWERSHELL_QUOTES = /['‘’‚‛]/g;
const POSIX_ESCAPED_QUOTE = String.raw`'\''`;

/** A shell word for `value`, quoted only when it needs to be. */
export function quoteShellArg(kind: TerminalShellKind, value: string): string {
  switch (kind) {
    case "powershell":
      if (POWERSHELL_SAFE.test(value)) return value;
      return `'${value.replace(POWERSHELL_QUOTES, (quote) => quote + quote)}'`;
    case "cmd":
      // An interactive cmd line still expands %VAR% inside double quotes and
      // has no escape for it, so a value with a % pair can change there.
      if (value !== "" && !CMD_SPECIAL.test(value)) return value;
      return `"${value.replaceAll('"', '""')}"`;
    case "fish": {
      if (POSIX_SAFE.test(value)) return value;
      const escaped = value.replaceAll("\\", String.raw`\\`).replaceAll("'", String.raw`\'`);
      return `'${escaped}'`;
    }
    default:
      if (POSIX_SAFE.test(value)) return value;
      return `'${value.replaceAll("'", POSIX_ESCAPED_QUOTE)}'`;
  }
}

/**
 * The line that runs `command` with `args` in a shell of this kind, without
 * the Enter that submits it. PowerShell needs `&` to run a quoted program.
 */
export function shellCommandLine(kind: TerminalShellKind, command: TerminalCommand): string {
  const args = command.args.map((arg) => quoteShellArg(kind, arg));
  if (kind === "powershell") {
    const program = `'${command.command.replace(POWERSHELL_QUOTES, (quote) => quote + quote)}'`;
    return ["&", program, ...args].join(" ");
  }
  return [quoteShellArg(kind, command.command), ...args].join(" ");
}

/** A project path as the shell expects it: backslashes for cmd and PowerShell on Windows. */
export function terminalPathArg(kind: TerminalShellKind, platform: TerminalPlatform, path: string): string {
  const windowsShell = platform === "windows" && (kind === "cmd" || kind === "powershell");
  return quoteShellArg(kind, windowsShell ? path.replaceAll("/", "\\") : path);
}

/**
 * A project path as an absolute path for the shell, from the project
 * folder's path on this computer: `C:/…` for Git Bash (terminalPathArg turns
 * it into backslashes for cmd and PowerShell) and `/mnt/c/…` under WSL.
 * Null when WSL can't name the folder (a network share).
 */
export function absoluteTerminalPath(
  root: string,
  path: string,
  platform: TerminalPlatform,
  wsl: boolean,
): string | null {
  const joined = `${root.replace(/[\\/]+$/, "")}/${path}`;
  if (platform !== "windows") return joined;
  const forward = joined.replaceAll("\\", "/");
  if (!wsl) return forward;
  const drive = /^([A-Za-z]):\//.exec(forward);
  return drive ? `/mnt/${drive[1].toLowerCase()}/${forward.slice(3)}` : null;
}

function segments(path: string): string[] {
  return path.split("/").filter((part) => part !== "" && part !== ".");
}

/** `toPath` relative to `fromFolder`, both project-relative with `/` separators. */
export function relativeTerminalPath(fromFolder: string, toPath: string): string {
  const from = segments(fromFolder);
  const to = segments(toPath);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common += 1;
  const parts = [...from.slice(common).map(() => ".."), ...to.slice(common)];
  return parts.length > 0 ? parts.join("/") : ".";
}

/** Whether `value` holds a C0 control character or DEL. */
export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Pasted text without ESC. An ESC [201~ inside the text would end
 * bracketed paste early, and the shell would run the rest as typed keys.
 */
export function withoutEscapes(value: string): string {
  return value.replaceAll("\x1b", "");
}
