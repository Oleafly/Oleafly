import { invoke } from "@tauri-apps/api/core";
import type { CollabLiveInfo } from "@/lib/tauri";

export interface OverleafLiveProject {
  server: string;
  remoteId: string;
  signedIn: boolean;
  paused: boolean;
}

export interface OverleafPauseOutcome {
  paused: boolean;
  unsent: string[];
}

export const overleafLiveProject = (projectId: string) =>
  invoke<OverleafLiveProject | null>("overleaf_live_project", { projectId });

export const overleafLiveStart = (projectId: string) =>
  invoke<CollabLiveInfo>("overleaf_live_start", { projectId });

export const overleafLiveStop = (projectId: string) => invoke<void>("overleaf_live_stop", { projectId });

export const overleafLivePause = (projectId: string, anyway = false) =>
  invoke<OverleafPauseOutcome>("overleaf_live_pause", { projectId, anyway });

export const overleafLiveResume = (projectId: string) => invoke<void>("overleaf_live_resume", { projectId });

export const overleafLiveUnlink = (projectId: string) => invoke<void>("overleaf_live_unlink", { projectId });

export function overleafProjectPage(link: Pick<OverleafLiveProject, "server" | "remoteId">): string {
  return `${link.server.replace(/\/+$/u, "")}/project/${encodeURIComponent(link.remoteId)}`;
}
