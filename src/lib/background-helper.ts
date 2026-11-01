import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type LoginItemState =
  | { state: "enabled" | "disabled" | "move_app" }
  | { state: "unsupported"; reason: string };

export type HelperPhase = "starting" | "ready" | "stopping" | "exiting";

export interface BackgroundHelperStatus {
  enabled: boolean;
  atLogin: LoginItemState;
  running: boolean;
  hung: boolean;
  phase: HelperPhase | null;
  taskCount: number;
  logPath: string;
}

export const BACKGROUND_HELPER_CHANGED = "background-helper-changed";

export const getBackgroundHelperStatus = () => invoke<BackgroundHelperStatus>("background_helper_status");

export const stopBackgroundHelper = () => invoke<BackgroundHelperStatus>("background_helper_stop");

export const setBackgroundHelperAtLogin = (enabled: boolean) =>
  invoke<BackgroundHelperStatus>("background_helper_set_login_item", { enabled });

export const setBackgroundTasksEnabled = (enabled: boolean) =>
  invoke<void>("background_tasks_set_enabled", { enabled });

export const revealBackgroundHelperLog = () => invoke<void>("background_helper_reveal_log");

export const listenForBackgroundHelper = (onChange: () => void): Promise<UnlistenFn> =>
  listen(BACKGROUND_HELPER_CHANGED, () => onChange());
