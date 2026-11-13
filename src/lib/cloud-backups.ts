import { invoke } from "@tauri-apps/api/core";

export const BACKUP_EVERY_HOURS = [6, 24, 168] as const;
export const BACKUP_KEEP = [7, 14, 30, 90] as const;

export interface CloudBackupSettings {
  auto: boolean;
  everyHours: number;
  keep: number;
  includeProjects: boolean;
}

export interface CloudBackupLast {
  notes: number;
  projects: number;
  bytes: number;
}

export interface CloudBackupState {
  settings: CloudBackupSettings;
  lastRunMs: number | null;
  lastOkMs: number | null;
  lastError: string | null;
  last: CloudBackupLast | null;
  running: boolean;
  due: boolean;
}

export interface CloudBackupOutcome {
  id: string;
  notes: number;
  projects: number;
  bytes: number;
  uploadedBytes: number;
  skipped: string[];
  removedSets: number;
}

export interface CloudBackupRun {
  ran: boolean;
  outcome: CloudBackupOutcome | null;
  error: string | null;
}

export interface CloudBackupSummary {
  id: string;
  device: string;
  deviceName: string;
  thisDevice: boolean;
  createdMs: number;
  scheduled: boolean;
  notes: number;
  projects: number;
  bytes: number;
}

export interface CloudBackupEntry {
  id: string;
  kind: "note" | "project";
  name: string;
  files: number;
  bytes: number;
  here: boolean;
}

export interface CloudRestoreResult {
  restored: { from: string; to: string; name: string; copy: boolean }[];
  here: string[];
  failed: { id: string; name: string; error: string }[];
}

export const cloudBackupState = () => invoke<CloudBackupState>("cloud_backup_state");

export const cloudBackupSetSettings = (settings: CloudBackupSettings) =>
  invoke<CloudBackupState>("cloud_backup_set_settings", { settings });

export const cloudBackupRun = (scheduled: boolean) => invoke<CloudBackupRun>("cloud_backup_run", { scheduled });

export const cloudBackupList = () => invoke<CloudBackupSummary[]>("cloud_backup_list");

export const cloudBackupEntries = (device: string, id: string) =>
  invoke<CloudBackupEntry[]>("cloud_backup_entries", { device, id });

export const cloudBackupRestore = (device: string, id: string, items: string[] | null, copyLabel: string) =>
  invoke<CloudRestoreResult>("cloud_backup_restore", { device, id, items, copyLabel });
