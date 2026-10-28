import { invoke } from "@tauri-apps/api/core";

export interface CloudSpace {
  used: number;
  allocated: number;
}

export type CloudStatus = "connected" | "disconnected" | "revoked";

export type CloudProjectMode = "sync" | "pause" | "download" | "held" | "removed";

export interface CloudHold {
  /** `massDelete`: files deleted here; `remoteDelete`: files no longer in the cloud. */
  kind: "massDelete" | "remoteDelete";
  count: number;
  total: number;
}

export type CloudSkipReason =
  | "unsupportedName"
  | "duplicateName"
  | "symlink"
  | "specialFile"
  | "tooLarge"
  | "packageFolder"
  | "zipLeftovers"
  | "unreadable"
  | "downloadFailed"
  | "uploadFailed";

export interface CloudSkippedFile {
  path: string;
  reason: CloudSkipReason;
}

export interface CloudProject {
  localId: string | null;
  cloudId: string;
  name: string;
  mode: CloudProjectMode;
  lastSyncedMs: number;
  sizeBytes: number;
  error: string | null;
  conflicts: number;
  skipped: number;
  skippedFiles: CloudSkippedFile[];
  conflictCopies: string[];
  hold: CloudHold | null;
  recycled: boolean;
  removedBy: string | null;
  pendingFiles: number | null;
  uploadingFrom: string | null;
}

/** A storage provider sync can use. Matches `ProviderKind` in Rust. */
export type CloudProviderKind = "dropbox" | "google_drive" | "s3";

export interface CloudProviderInfo {
  kind: CloudProviderKind;
  /** Browser sign-in, or keys typed into a form. */
  auth: "oauth" | "credentials";
  /** False when this build can't connect it. */
  available: boolean;
  pasteCode: boolean;
  /** Whether the provider reports used and total space. */
  quota: boolean;
}

/** Where an S3-compatible bucket is and how to reach it. */
export interface S3ConnectConfig {
  endpoint: string;
  region: string;
  bucket: string;
  /** The folder in the bucket that sync keeps everything under. */
  prefix: string;
  /** Put the bucket in the path instead of the host name, as MinIO and most self-hosted servers need. */
  pathStyle: boolean;
}

export interface CloudState {
  status: CloudStatus;
  /** The connected provider, or null when nothing is connected. */
  provider: CloudProviderKind | null;
  /** The account's email, or for S3 a label naming the bucket and server. */
  email: string | null;
  displayName: string | null;
  deviceName: string;
  enabled: boolean;
  lastEmail: string | null;
  lastSyncedMs: number;
  lastError: string | null;
  quotaFull: boolean;
  linkedCount: number;
  projects: CloudProject[];
}

export interface CloudDetails {
  space: CloudSpace | null;
  remote: CloudProject[];
  error: string | null;
}

export interface SyncProjectReport {
  localId: string;
  uploaded: number;
  downloaded: number;
  deletedRemote: number;
  deletedLocal: number;
  conflicts: number;
  skipped: number;
  held: boolean;
  error: string | null;
  changed: string[];
  changedTruncated: boolean;
}

export interface SyncReport {
  projects: SyncProjectReport[];
  lastSyncedMs: number;
  error: string | null;
}

export interface CloudDirtyFile {
  localId: string;
  path: string;
}

export interface ConnectBegin {
  flowId: string;
  authUrl: string;
  paste: boolean;
}

export interface DownloadDone {
  localId: string;
  restored: boolean;
}

export type SettingsSyncOutcome =
  | { outcome: "current" }
  | { outcome: "pushed" }
  | { outcome: "apply"; values: Record<string, unknown>; stamp: string }
  | { outcome: "choose"; values: Record<string, unknown>; stamp: string; deferred: boolean };

export interface CloudSettingsDownload {
  values: Record<string, unknown> | null;
  stamp: string;
}

export function cloudState(): Promise<CloudState> {
  return invoke<CloudState>("cloud_state");
}

export function cloudDetails(): Promise<CloudDetails> {
  return invoke<CloudDetails>("cloud_details");
}

export function cloudProviders(): Promise<CloudProviderInfo[]> {
  return invoke<CloudProviderInfo[]>("cloud_providers");
}

export function cloudConnectBegin(
  paste: boolean,
  provider: CloudProviderKind = "dropbox",
): Promise<ConnectBegin> {
  return invoke<ConnectBegin>("cloud_connect_begin", { provider, paste });
}

export function cloudConnectWait(flowId: string): Promise<{ email: string }> {
  return invoke<{ email: string }>("cloud_connect_wait", { flowId });
}

export function cloudConnectPaste(flowId: string, code: string): Promise<{ email: string }> {
  return invoke<{ email: string }>("cloud_connect_paste", { flowId, code });
}

/** Connects a provider that takes keys instead of a browser sign-in. */
export function cloudConnectCredentials(
  provider: CloudProviderKind,
  config: S3ConnectConfig,
  accessKeyId: string,
  secretAccessKey: string,
): Promise<{ email: string }> {
  return invoke<{ email: string }>("cloud_connect_credentials", { provider, config, accessKeyId, secretAccessKey });
}

export function cloudConnectCancel(flowId: string): Promise<void> {
  return invoke<void>("cloud_connect_cancel", { flowId });
}

export interface CloudDisconnectDone {
  /** False when the provider couldn't be reached to end Oleafly's access. */
  remoteRevoked: boolean;
}

export function cloudDisconnect(): Promise<CloudDisconnectDone> {
  return invoke<CloudDisconnectDone>("cloud_disconnect");
}

export function cloudSetEnabled(on: boolean): Promise<void> {
  return invoke<void>("cloud_set_enabled", { on });
}

export function cloudSetDeviceName(name: string): Promise<void> {
  return invoke<void>("cloud_set_device_name", { name });
}

export function cloudSyncNow(dirty: CloudDirtyFile[]): Promise<SyncReport> {
  return invoke<SyncReport>("cloud_sync_now", { dirty });
}

export function cloudProjectSetMode(localId: string, mode: "sync" | "pause"): Promise<void> {
  return invoke<void>("cloud_project_set_mode", { localId, mode });
}

export function cloudProjectResolveHold(
  localId: string,
  choice: "restore" | "delete",
  dirty: CloudDirtyFile[],
): Promise<SyncProjectReport> {
  return invoke<SyncProjectReport>("cloud_project_resolve_hold", { localId, choice, dirty });
}

export function cloudProjectDismissConflicts(localId: string): Promise<void> {
  return invoke<void>("cloud_project_dismiss_conflicts", { localId });
}

export function cloudProjectReplaceRemote(localId: string, dirty: CloudDirtyFile[]): Promise<SyncProjectReport> {
  return invoke<SyncProjectReport>("cloud_project_replace_remote", { localId, dirty });
}

export function cloudRemoveRemote(cloudId: string): Promise<void> {
  return invoke<void>("cloud_remove_remote", { cloudId });
}

export function cloudProjectRemove(localId: string): Promise<void> {
  return invoke<void>("cloud_project_remove", { localId });
}

export function cloudDownloadProject(cloudId: string): Promise<DownloadDone> {
  return invoke<DownloadDone>("cloud_download_project", { cloudId });
}

export function cloudSettingsSync(values: Record<string, unknown>): Promise<SettingsSyncOutcome> {
  return invoke<SettingsSyncOutcome>("cloud_settings_sync", { values });
}

export function cloudSettingsDownload(): Promise<CloudSettingsDownload> {
  return invoke<CloudSettingsDownload>("cloud_settings_download");
}

export function cloudSettingsApplied(stamp: string, values: Record<string, unknown>): Promise<void> {
  return invoke<void>("cloud_settings_applied", { stamp, values });
}

export function cloudSettingsKeepLocal(values: Record<string, unknown>): Promise<void> {
  return invoke<void>("cloud_settings_keep_local", { values });
}

export function cloudSettingsDefer(stamp: string): Promise<void> {
  return invoke<void>("cloud_settings_defer", { stamp });
}

export interface CloudWait {
  changes: boolean;
  retryAfterMs: number | null;
}

export function cloudWaitForChanges(): Promise<CloudWait> {
  return invoke<CloudWait>("cloud_wait_for_changes");
}

export const CLOUD_PROGRESS_EVENT = "cloud-progress";

export type CloudProgressPhase = "uploading" | "downloading" | "fetching";

export interface CloudProgress {
  projectId: string | null;
  cloudId: string;
  phase: CloudProgressPhase;
  done: number;
  total: number;
}
