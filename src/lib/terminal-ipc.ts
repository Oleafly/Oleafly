import { type Channel, invoke } from "@tauri-apps/api/core";
import type { ExternalTerminalId, TerminalShellId } from "@/store/settings";
import type { TerminalCommand, TerminalShellKind } from "./terminal-quote";

export type TerminalChannelMessage =
  | { event: "output"; data: string; bytes: number }
  | { event: "exit" }
  | { event: "input_error"; message: string };

export interface TerminalOpenOptions {
  cwd?: string;
  env?: Record<string, string>;
  shell?: { id: TerminalShellId; path?: string };
  launch?: boolean;
}

export interface TerminalOpened {
  id: string;
  shell: TerminalShellKind;
  shellId: TerminalShellId;
  shellName?: string;
  root?: string;
}

export interface TerminalShellOption {
  id: TerminalShellId;
  resolved: TerminalShellId;
  name: string | null;
  path: string | null;
  available: boolean;
}

export interface ExternalTerminalOption {
  id: ExternalTerminalId;
  name: string;
  detail: string | null;
  available: boolean;
}

export function externalTerminals(): Promise<ExternalTerminalOption[]> {
  return invoke<ExternalTerminalOption[]>("external_terminals");
}

export function openExternalTerminal(args: {
  projectId: string;
  terminal: ExternalTerminalId;
  cwd?: string;
  command?: TerminalCommand;
  env?: Record<string, string>;
}): Promise<void> {
  return invoke<void>("open_external_terminal", {
    projectId: args.projectId,
    terminal: args.terminal,
    cwd: args.cwd ?? null,
    command: args.command ?? null,
    env: args.env ?? null,
  });
}

export interface TerminalJob {
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

export function termForeground(projectId: string, ids?: readonly string[]): Promise<TerminalJob[]> {
  return invoke<TerminalJob[]>("term_foreground", { projectId, ids });
}

export function termShells(): Promise<TerminalShellOption[]> {
  return invoke<TerminalShellOption[]>("term_shells");
}
