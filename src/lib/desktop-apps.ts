import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ToolSet } from "@/lib/chat-types";

export interface DesktopAppsToolSpec {
  name: "desktop_apps";
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AllowedApp {
  name: string;
  bundleId?: string;
  executable?: string;
}

export interface AllowedSite {
  origin: string;
  signedIn: boolean;
}

export interface DesktopAppsSettings {
  enabled: boolean;
  apps: AllowedApp[];
  sites: AllowedSite[];
  scriptedControl: boolean;
  askBeforeActions: boolean;
}

export type BlockReason =
  | "oleafly"
  | "driver"
  | "terminal"
  | "system_settings"
  | "passwords"
  | "scripting"
  | "wrapper"
  | "sandboxed"
  | "browser";

export interface InstalledApp extends AllowedApp {
  blocked?: BlockReason;
}

export interface TerminalCommand {
  program: string;
  args: string[];
}

export type DesktopAppsRuntime = "desktop" | "browser" | "signed-in-browser";

export type DriverProblem = "not_installed" | "too_old" | "no_app_bundle" | "unreadable_version";

export interface DesktopAppsStatus {
  platform: "macos" | "windows" | "linux";
  supported: boolean;
  driverPath: string | null;
  driverVersion: string | null;
  driverProblem: DriverProblem | null;
  minimumVersion: string;
  installLine: string;
  installCommand: TerminalCommand;
  permissions: {
    accessibility: boolean | null;
    screenRecording: boolean | null;
    unchecked?: boolean;
  } | null;
  gnomeHelper: boolean | null;
  gnomeHelperLine: string | null;
  running: DesktopAppsRuntime[];
  spacesCliPath: string | null;
  spacesInstallLine: string;
  spacesInstallCommand: TerminalCommand;
  settings: DesktopAppsSettings;
  missingApps: string[];
}

export interface DesktopAppsTestReport {
  ok: boolean;
  version: string | null;
  runtimes: { kind: DesktopAppsRuntime; ok: boolean; detail: string | null }[];
  problems: string[];
}

export const cuaDriverStatus = () => invoke<DesktopAppsStatus>("cua_driver_status");

export const cuaDriverSettingsSet = (settings: DesktopAppsSettings) =>
  invoke<DesktopAppsSettings>("cua_driver_settings_set", { settings });

export const cuaDriverInstalledApps = () => invoke<InstalledApp[]>("cua_driver_installed_apps");

export const cuaDriverPickApp = () => invoke<InstalledApp | null>("cua_driver_pick_app");

export const cuaDriverAppIcons = (keys: string[]) =>
  invoke<Record<string, string>>("cua_driver_app_icons", { keys });

export const cuaDriverTest = () => invoke<DesktopAppsTestReport>("cua_driver_test");

export const cuaDriverToolSpec = () => invoke<DesktopAppsToolSpec | null>("cua_driver_tool_spec");

let toolSpec: DesktopAppsToolSpec | null = null;

export async function syncDesktopAppsTool(): Promise<void> {
  if (!isTauri()) {
    toolSpec = null;
    return;
  }
  try {
    toolSpec = (await cuaDriverToolSpec()) ?? null;
  } catch {
    toolSpec = null;
  }
}

export function createDesktopAppsTools(): ToolSet {
  if (!toolSpec) return {};
  return {
    desktop_apps: {
      description: toolSpec.description,
      inputSchema: toolSpec.inputSchema,
      execute: () => Promise.resolve({ error: "Desktop apps run inside the Oleafly app only." }),
    },
  };
}
