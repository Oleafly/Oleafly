import { invoke } from "@tauri-apps/api/core";
import type { ProjectStateChanged } from "@oleafly/backend-port";

export type SyncSide = "local" | "remote";

export interface OverleafSyncStatus {
  linked: boolean;
  server: string;
  remoteId: string | null;
  auto: boolean;
  lastSyncAt: number | null;
  tokenSaved: boolean;
  importedFrom: { server: string; projectId: string } | null;
  backupsFolder?: string;
}

export interface OverleafSyncReport {
  outcome: "linked" | "needs-choice" | "up-to-date" | "synced" | "conflicts" | "needs-merge";
  files: string[];
  pulled: number;
  pushed: boolean;
  state: ProjectStateChanged | null;
}

const serverArg = (server: string | null | undefined) => server?.trim() || null;

export function overleafSyncStatus(projectId: string): Promise<OverleafSyncStatus> {
  return invoke<OverleafSyncStatus>("overleaf_sync_status", { projectId });
}

export function overleafSyncLink(
  projectId: string,
  expectedGeneration: number,
  server: string | null,
  remoteId: string,
  prefer: SyncSide | null,
): Promise<OverleafSyncReport> {
  return invoke<OverleafSyncReport>("overleaf_sync_link", {
    projectId,
    expectedGeneration,
    server: serverArg(server),
    remoteId,
    prefer,
  });
}

export function overleafSyncCheck(projectId: string): Promise<OverleafSyncReport> {
  return invoke<OverleafSyncReport>("overleaf_sync_check", { projectId });
}

export function overleafSyncNow(
  projectId: string,
  expectedGeneration: number,
  resolutions: Record<string, SyncSide> | null,
  fetched = false,
): Promise<OverleafSyncReport> {
  return invoke<OverleafSyncReport>("overleaf_sync_now", { projectId, expectedGeneration, resolutions, fetched });
}

export function overleafSyncUnlink(projectId: string): Promise<OverleafSyncStatus> {
  return invoke<OverleafSyncStatus>("overleaf_sync_unlink", { projectId });
}

export function overleafSyncSetAuto(projectId: string, auto: boolean): Promise<OverleafSyncStatus> {
  return invoke<OverleafSyncStatus>("overleaf_sync_set_auto", { projectId, auto });
}

export function overleafGitTokenStatus(server: string | null): Promise<boolean> {
  return invoke<boolean>("overleaf_git_token_status", { server: serverArg(server) });
}

export function overleafGitTokenSet(server: string | null, token: string): Promise<void> {
  return invoke<void>("overleaf_git_token_set", { server: serverArg(server), token });
}

export function overleafGitTokenClear(server: string | null): Promise<void> {
  return invoke<void>("overleaf_git_token_clear", { server: serverArg(server) });
}

export function overleafTokenPage(server: string): string {
  let end = server.length;
  while (end > 0 && server[end - 1] === "/") end -= 1;
  return `${server.slice(0, end)}/user/settings`;
}
