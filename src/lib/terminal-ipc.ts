// Typed wrappers for the terminal's Tauri commands and the messages its
// output channel carries. Thin on purpose: callers decide what a failure means.
import { type Channel, invoke } from "@tauri-apps/api/core";
import type { TerminalShellId } from "@/store/settings";
import type { TerminalShellKind } from "./terminal-quote";

export type TerminalChannelMessage =
  /** `bytes` is the UTF-8 length of `data`; acknowledge it once parsed. */
  | { event: "output"; data: string; bytes: number }
  | { event: "exit" }
  | { event: "input_error"; message: string };

export interface TerminalOpenOptions {
  /** Project-relative start folder with `/` separators. */
  cwd?: string;
  env?: Record<string, string>;
  shell?: { id: TerminalShellId; path?: string };
}

export interface TerminalOpened {
  id: string;
  /** How the shell quotes the commands Oleafly types into it. */
  shell: TerminalShellKind;
  /** The shell that started (`auto` resolves to `pwsh` or `powershell` on Windows). */
  shellId: TerminalShellId;
  /** The shell program's name, such as `zsh` or `bash`. */
  shellName?: string;
}

export interface TerminalShellOption {
  id: TerminalShellId;
  /** What `auto` starts on this computer; the id itself otherwise. */
  resolved: TerminalShellId;
  name: string | null;
  path: string | null;
  available: boolean;
}

export interface TerminalJob {
  /** The session id. */
  id: string;
  process: string | null;
}

export function termOpen(args: {
  projectId: string;
  cols: number;
  rows: number;
  autostart: boolean;
  options: TerminalOpenOptions;
  channel: Channel<TerminalChannelMessage>;
}): Promise<TerminalOpened> {
  return invoke<TerminalOpened>("term_open", args);
}

export function termWrite(projectId: string, id: string, data: string): Promise<void> {
  return invoke<void>("term_write", { id, projectId, data });
}

export function termResize(projectId: string, id: string, cols: number, rows: number): Promise<void> {
  return invoke<void>("term_resize", { id, projectId, cols, rows });
}

export function termKill(projectId: string, id: string): Promise<void> {
  return invoke<void>("term_kill", { id, projectId });
}

export function termAck(projectId: string, id: string, bytes: number): Promise<void> {
  return invoke<void>("term_ack", { id, projectId, bytes });
}

/** Which of the project's sessions (all, or `ids`) run a program besides their shell. */
export function termForeground(projectId: string, ids?: readonly string[]): Promise<TerminalJob[]> {
  return invoke<TerminalJob[]>("term_foreground", { projectId, ids });
}

export function termShells(): Promise<TerminalShellOption[]> {
  return invoke<TerminalShellOption[]>("term_shells");
}
