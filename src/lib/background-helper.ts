// 0.4.8 L: the background helper that keeps research tasks running after
// Oleafly quits, as Settings › Research shows it.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Whether the helper starts when the user signs in. */
export type LoginItemState =
  | { state: "enabled" | "disabled" | "move_app" }
  | { state: "unsupported"; reason: string };

export type HelperPhase = "starting" | "ready" | "stopping" | "exiting";

export interface BackgroundHelperStatus {
  /** "Keep tasks running after Oleafly closes". */
  enabled: boolean;
  atLogin: LoginItemState;
  running: boolean;
  /** Running, but its heartbeat stopped. */
  hung: boolean;
  phase: HelperPhase | null;
  /** Tasks the helper runs or will start. */
  taskCount: number;
  logPath: string;
}

/** What the helper card listens to. */
export const BACKGROUND_HELPER_CHANGED = "background-helper-changed";

export const getBackgroundHelperStatus = () => invoke<BackgroundHelperStatus>("background_helper_status");

/** Asks the helper to hand its tasks back and exit; ends it if it stays. */
export const stopBackgroundHelper = () => invoke<BackgroundHelperStatus>("background_helper_stop");

export const setBackgroundHelperAtLogin = (enabled: boolean) =>
  invoke<BackgroundHelperStatus>("background_helper_set_login_item", { enabled });

/** Off also removes the sign-in entry and brings the helper's tasks back. */
export const setBackgroundTasksEnabled = (enabled: boolean) =>
  invoke<void>("background_tasks_set_enabled", { enabled });

export const revealBackgroundHelperLog = () => invoke<void>("background_helper_reveal_log");

export const listenForBackgroundHelper = (onChange: () => void): Promise<UnlistenFn> =>
  listen(BACKGROUND_HELPER_CHANGED, () => onChange());
