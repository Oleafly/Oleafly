import type { OverleafConnectionDetails } from "@oleafly/backend-port";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { logWarning } from "@/lib/log";
import type { OverleafAccount } from "@/lib/overleaf";
import { withoutTrailingSlashes } from "@/lib/path-utils";
import { openInSystemBrowser } from "@/lib/system-browser";
import type { CollabErrorCode, CollabLiveInfo, CollabProjectMember } from "@/lib/tauri";

export interface OverleafLiveProject {
  server: string;
  remoteId: string;
  signedIn: boolean;
  paused: boolean;
  account?: OverleafAccount | null;
  unfilled?: boolean;
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

export interface OverleafImage {
  name: string;
  description: string;
}

export interface OverleafLiveSettings {
  image: string | null;
  images: OverleafImage[];
  bibliography: string | null;
  bibliographies: string[];
  canChange: boolean;
}

export type OverleafSettingChoice = "image" | "bibliography";

export const overleafLiveSettings = (projectId: string) =>
  invoke<OverleafLiveSettings>("overleaf_live_settings", { projectId });

export const overleafLiveSetSetting = (projectId: string, setting: OverleafSettingChoice, value: string) =>
  invoke<void>("overleaf_live_set_setting", { projectId, setting, value });

export const overleafLiveMembers = (projectId: string) =>
  invoke<CollabProjectMember[]>("overleaf_live_members", { projectId });

export function onOverleafLiveMembers(handler: (projectId: string) => void): Promise<UnlistenFn> {
  return listen<{ projectId: string }>("overleaf-live-members", ({ payload }) => handler(payload.projectId));
}

export function serverHost(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

export function overleafProjectUrl(link: Pick<OverleafLiveProject, "server" | "remoteId">): string {
  return `${withoutTrailingSlashes(link.server)}/project/${encodeURIComponent(link.remoteId)}`;
}

export async function openOverleafProject(link: Pick<OverleafLiveProject, "server" | "remoteId">): Promise<void> {
  const page = overleafProjectUrl(link);
  if (!(await openInSystemBrowser(page))) {
    void logWarning("open the project's online page", `the system browser didn't open ${serverHost(link.server)}`);
  }
}

type OverleafTreePathsKind = "delete_asked" | "not_allowed" | "kept_away" | "stored_as_files" | "linked_kept";

export interface OverleafLinkedFile {
  path: string;
  provider: string;
  url: string | null;
  sourceProject: string | null;
  sourcePath: string | null;
}

export type OverleafTreeNotice =
  | { projectId: string; kind: OverleafTreePathsKind; paths: string[] }
  | { projectId: string; kind: "linked"; files: OverleafLinkedFile[] };

const OVERLEAF_LIVE_TREE_EVENT = "overleaf-live-tree";

export const onOverleafLiveTree = (handler: (notice: OverleafTreeNotice) => void): Promise<UnlistenFn> =>
  listen<OverleafTreeNotice>(OVERLEAF_LIVE_TREE_EVENT, ({ payload }) => handler(payload));

export const overleafLiveDelete = (projectId: string, paths: string[], onOverleaf: boolean) =>
  invoke<void>("overleaf_live_delete", { projectId, paths, onOverleaf });

export const overleafLiveRestore = (projectId: string, path: string) =>
  invoke<void>("overleaf_live_restore", { projectId, path });

export const overleafLiveRefreshLinked = (projectId: string, path: string) =>
  invoke<void>("overleaf_live_refresh_linked", { projectId, path });

export interface OverleafLearnedWords {
  account: string;
  words: string[] | null;
}

export interface OverleafWordsSent {
  learned: string[];
  unlearned: string[];
  stopped: CollabErrorCode | null;
}

export const overleafLiveLearnedWords = (projectId: string) =>
  invoke<OverleafLearnedWords>("overleaf_live_learned_words", { projectId });

export const overleafLiveLearnWords = (projectId: string, learn: string[], unlearn: string[]) =>
  invoke<OverleafWordsSent>("overleaf_live_learn_words", { projectId, learn, unlearn });
