// 0.4.8 I: Desktop apps through Cua Driver. Rust owns the settings, the
// approval gate and the tool itself (it answers `desktop_apps` before any
// webview round trip); this module only talks to it. Keep its imports small:
// the chat toolsets load it with the app.
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ToolSet } from "@/lib/chat-types";

export interface DesktopAppsToolSpec {
  name: "desktop_apps";
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AllowedApp {
  name: string;
  /** macOS. */
  bundleId?: string;
  /** Windows and Linux: the canonical program path. */
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
  /** Every action asks in a dialog first; off by default. */
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

/** A program and its arguments, for `openTerminalWith`. */
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
  /** The official install line, shown for copying. */
  installLine: string;
  /** The same line as a program and its arguments, for the terminal. */
  installCommand: TerminalCommand;
  permissions: {
    accessibility: boolean | null;
    screenRecording: boolean | null;
    /** Cua Driver answered that it hasn't checked yet; the grant step finds out. */
    unchecked?: boolean;
  } | null;
  gnomeHelper: boolean | null;
  gnomeHelperLine: string | null;
  running: DesktopAppsRuntime[];
  spacesCliPath: string | null;
  spacesInstallLine: string;
  spacesInstallCommand: TerminalCommand;
  settings: DesktopAppsSettings;
  /** Allowed apps (Windows and Linux) whose program is no longer on this computer, by `executable`. */
  missingApps: string[];
}

export interface DesktopAppsTestReport {
  ok: boolean;
  version: string | null;
  runtimes: { kind: DesktopAppsRuntime; ok: boolean; detail: string | null }[];
  problems: string[];
}

export const cuaDriverStatus = () => invoke<DesktopAppsStatus>("cua_driver_status");

/** Rust validates and asks natively before anything widens. */
export const cuaDriverSettingsSet = (settings: DesktopAppsSettings) =>
  invoke<DesktopAppsSettings>("cua_driver_settings_set", { settings });

export const cuaDriverInstalledApps = () => invoke<InstalledApp[]>("cua_driver_installed_apps");

export const cuaDriverPickApp = () => invoke<InstalledApp | null>("cua_driver_pick_app");

/** The picker rows' icons as data URLs, by row key; apps without one are left out. */
export const cuaDriverAppIcons = (keys: string[]) =>
  invoke<Record<string, string>>("cua_driver_app_icons", { keys });

export const cuaDriverTest = () => invoke<DesktopAppsTestReport>("cua_driver_test");

/** The tool spec, which exists only once the connector is on with something allowed. */
export const cuaDriverToolSpec = () => invoke<DesktopAppsToolSpec | null>("cua_driver_tool_spec");

let toolSpec: DesktopAppsToolSpec | null = null;

/** Refreshes the cached tool spec: `null` until the connector is ready. */
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

/**
 * The `desktop_apps` tool for chat runs, or nothing. Rust answers the call
 * before it reaches the webview, so `execute` only runs outside the app.
 */
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
