import { invoke } from "@tauri-apps/api/core";

export interface CloudSpace {
  used: number;
  allocated: number;
}

export interface CloudProject {
  localId: string | null;
  cloudId: string;
  name: string;
  mode: "sync" | "pause" | "download";
  lastSyncedMs: number;
}

export interface CloudState {
  status: "connected" | "disconnected";
  email: string | null;
  displayName: string | null;
  deviceName: string;
  enabled: boolean;
  lastEmail: string | null;
  space: CloudSpace | null;
  projects: CloudProject[];
}

export interface SyncProjectReport {
  localId: string;
  uploaded: number;
  downloaded: number;
  deletedRemote: number;
  deletedLocal: number;
  conflicts: number;
  error: string | null;
}

export interface SyncReport {
  projects: SyncProjectReport[];
  lastSyncedMs: number;
}

export interface ConnectBegin {
  flowId: string;
  authUrl: string;
  paste: boolean;
}

export function cloudState(): Promise<CloudState> {
  return invoke<CloudState>("cloud_state");
}

export function cloudConnectBegin(paste: boolean): Promise<ConnectBegin> {
  return invoke<ConnectBegin>("cloud_connect_begin", { paste });
}

export function cloudConnectWait(flowId: string): Promise<{ email: string }> {
  return invoke<{ email: string }>("cloud_connect_wait", { flowId });
}

export function cloudConnectPaste(flowId: string, code: string): Promise<{ email: string }> {
  return invoke<{ email: string }>("cloud_connect_paste", { flowId, code });
}

export function cloudConnectCancel(flowId: string): Promise<void> {
  return invoke<void>("cloud_connect_cancel", { flowId });
}

export function cloudDisconnect(): Promise<void> {
  return invoke<void>("cloud_disconnect");
}

export function cloudSetEnabled(on: boolean): Promise<void> {
  return invoke<void>("cloud_set_enabled", { on });
}

export function cloudSetDeviceName(name: string): Promise<void> {
  return invoke<void>("cloud_set_device_name", { name });
}

export function cloudSyncNow(): Promise<SyncReport> {
  return invoke<SyncReport>("cloud_sync_now");
}

export function cloudProjectSetMode(localId: string, mode: "sync" | "pause"): Promise<void> {
  return invoke<void>("cloud_project_set_mode", { localId, mode });
}

export function cloudDownloadProject(cloudId: string): Promise<{ localId: string }> {
  return invoke<{ localId: string }>("cloud_download_project", { cloudId });
}

export function cloudSettingsSync(values: Record<string, unknown>): Promise<{ applied: Record<string, unknown> | null }> {
  return invoke<{ applied: Record<string, unknown> | null }>("cloud_settings_sync", { values });
}

export function cloudSettingsDownload(): Promise<{ values: Record<string, unknown> | null; stamp: number }> {
  return invoke<{ values: Record<string, unknown> | null; stamp: number }>("cloud_settings_download");
}

export function cloudSettingsApplied(stamp: number): Promise<void> {
  return invoke<void>("cloud_settings_applied", { stamp });
}
