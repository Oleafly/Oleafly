import { invoke } from "@tauri-apps/api/core";

const STATES = [
  "unsupported",
  "unavailable",
  "move_app",
  "not_installed",
  "installed",
  "outdated",
  "occupied",
  "packaged",
] as const;

export type ShellCommandState = (typeof STATES)[number];

export type ShellCommandMethod = "link" | "copy";

export interface ShellCommandPathHint {
  file: string | null;
  line: string;
}

export interface ShellCommandStatus {
  state: ShellCommandState;
  path?: string | null;
  directory?: string | null;
  method?: ShellCommandMethod | null;
  on_path?: boolean;
  after_sign_in?: boolean;
  hint?: ShellCommandPathHint | null;
}

export interface ShellCommandChange {
  action: "linked" | "copied" | "removed";
  status: ShellCommandStatus;
}

export function isShellCommandStatus(value: unknown): value is ShellCommandStatus {
  if (typeof value !== "object" || value === null || !("state" in value)) return false;
  return (STATES as readonly unknown[]).includes(value.state);
}

export const shellCommandStatus = () => invoke<ShellCommandStatus>("shell_command_status");

export const installShellCommand = () => invoke<ShellCommandChange>("shell_command_install");

export const removeShellCommand = () => invoke<ShellCommandChange>("shell_command_uninstall");
