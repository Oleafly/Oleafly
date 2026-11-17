import type { OverleafConnectionDetails } from "@oleafly/backend-port";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { withoutTrailingSlashes } from "@/lib/path-utils";
import type { CollabLiveInfo, CollabProjectMember } from "@/lib/tauri";

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

export const overleafLiveResolve = (projectId: string, path: string, keep: "mine" | "theirs") =>
  invoke<void>("overleaf_live_resolve", { projectId, path, keep });

export const overleafLiveRetry = (projectId: string, path: string) =>
  invoke<void>("overleaf_live_retry", { projectId, path });

export const overleafLiveKeepCopy = (projectId: string, path: string) =>
  invoke<void>("overleaf_live_keep_copy", { projectId, path });

export const overleafLiveConnectionDetails =(projectId: string) =>
  invoke<OverleafConnectionDetails>("overleaf_live_connection_details", { projectId });

export const overleafLiveMembers = (projectId: string) =>
  invoke<CollabProjectMember[]>("overleaf_live_members", { projectId });

export function onOverleafLiveMembers(handler: (projectId: string) => void): Promise<UnlistenFn> {
  return listen<{ projectId: string }>("overleaf-live-members", ({ payload }) => handler(payload.projectId));
}

export function overleafProjectPage(link: Pick<OverleafLiveProject, "server" | "remoteId">): string {
  return `${withoutTrailingSlashes(link.server)}/project/${encodeURIComponent(link.remoteId)}`;
}

export type OverleafTreeNoticeKind = "delete_asked" | "not_allowed" | "kept_away" | "stored_as_files";

export interface OverleafTreeNotice {
  projectId: string;
  kind: OverleafTreeNoticeKind;
  paths: string[];
}

export const OVERLEAF_LIVE_TREE_EVENT = "overleaf-live-tree";

export const onOverleafLiveTree = (handler: (notice: OverleafTreeNotice) => void): Promise<UnlistenFn> =>
  listen<OverleafTreeNotice>(OVERLEAF_LIVE_TREE_EVENT, ({ payload }) => handler(payload));

export const overleafLiveDelete = (projectId: string, paths: string[], onOverleaf: boolean) =>
  invoke<void>("overleaf_live_delete", { projectId, paths, onOverleaf });

export const overleafLiveRestore = (projectId: string, path: string) =>
  invoke<void>("overleaf_live_restore", { projectId, path });
