import type { OverleafToolOutcome, OverleafToolProject, OverleafToolsHost } from "@oleafly/ai-tools";
import { type CollabErrorParams, collabErrorParams, collabErrorText } from "@/features/collab/errors";
import { describeError } from "@/lib/app-error";
import type { CollabLiveStoreState } from "@/features/collab/live/live-store";
import { i18n } from "@/i18n";
import { overleafLiveActions, useLiveBackend } from "@/lib/collab-live-bridge";
import { logError, logWarning } from "@/lib/log";
import {
  isOverleafError,
  looksLikeOverleafLink,
  overleafListProjects,
  overleafSignIn,
  overleafStatus,
} from "@/lib/overleaf";
import { overleafLiveProject, serverHost } from "@/lib/overleaf-live";
import { importAndRefresh, openLiveAndRefresh } from "@/lib/overleaf-open";
import { collabLiveReconnectNow, collabShareInfo, isCollabCommandError } from "@/lib/tauri-collab";
import { useFilesStore } from "@/store/files";
import { useOverleafImportStore } from "@/store/overleaf-import";
import { useSettingsStore } from "@/store/settings";

type LiveTarget = Parameters<OverleafToolsHost["openLive"]>[0];
type LiveFound = Awaited<ReturnType<OverleafToolsHost["findLive"]>>;
type LiveOpened = Awaited<ReturnType<OverleafToolsHost["openLive"]>>;
type Refusal = Extract<LiveOpened, { refused: unknown }>;
type LiveStore = typeof import("@/features/collab/live/live-store").useCollabLiveStore;

export const LIVE_WAIT_MS = 20_000;

const PROJECT_PATH = /\/project\/([0-9a-f]{24})(?:[/?#]|$)/;
const SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

async function signedInServer(): Promise<string> {
  const server = useOverleafImportStore.getState().server;
  const status = await overleafStatus(server);
  if (status.signedIn) return status.server;
  const signedIn = await overleafSignIn(server, i18n.t(($) => $.library.import.overleaf.signInWindowTitle));
  useOverleafImportStore.setState({ status: signedIn });
  return signedIn.server;
}

export async function listProjects(): Promise<{
  email: string | null;
  server: string;
  projects: OverleafToolProject[];
}> {
  const server = await signedInServer();
  try {
    const listed = await overleafListProjects(server);
    return { email: listed.status.email, server: listed.status.server, projects: listed.projects };
  } catch (error) {
    if (!isOverleafError(error, "session_expired")) throw error;
    const again = await signedInServer();
    const listed = await overleafListProjects(again);
    return { email: listed.status.email, server: listed.status.server, projects: listed.projects };
  }
}

export async function importProjects(ids: string[]): Promise<OverleafToolOutcome[]> {
  await signedInServer();
  return importAndRefresh(ids);
}

function refuse(refusal: Refusal): Refusal {
  void logWarning("overleaf ai open live", refusal.detail ? `${refusal.refused}: ${refusal.detail}` : refusal.refused);
  return refusal;
}

function siteOf(host: string): string {
  return host.replace(/^www\./, "");
}

function linkHost(link: string): string | null {
  try {
    return new URL(SCHEME.test(link) ? link : `https://${link}`).host;
  } catch {
    return null;
  }
}

function remoteIdIn(text: string, server: string): string | Refusal {
  if (!looksLikeOverleafLink(text)) return text;
  const id = PROJECT_PATH.exec(text)?.[1];
  if (!id) return { refused: "share_link" };
  if (text.startsWith("/")) return id;
  const host = linkHost(text);
  return host !== null && siteOf(host) === siteOf(serverHost(server)) ? id : { refused: "other_server", detail: host ?? text };
}

function stoppingProject(keep: string | null): string | null {
  const live = useLiveBackend.getState();
  if (live.backend === null || live.projectId === null || live.projectId === keep) return null;
  const files = useFilesStore.getState();
  if (files.projectId === live.projectId && files.projectName) return files.projectName;
  return files.projects.find((project) => project.id === live.projectId)?.name ?? live.projectId;
}

async function sharedOnServer(projectId: string | null): Promise<boolean> {
  if (projectId === null) return false;
  try {
    return (await collabShareInfo(projectId)) !== null;
  } catch (error) {
    void logError("overleaf ai share check", error);
    return false;
  }
}

export async function findLive(id: string): Promise<LiveFound> {
  if (!useSettingsStore.getState().overleafLive) return refuse({ refused: "switch_off" });
  const remoteId = remoteIdIn(id, useOverleafImportStore.getState().server);
  if (typeof remoteId !== "string") return refuse(remoteId);
  try {
    const project = (await listProjects()).projects.find((entry) => entry.id === remoteId);
    if (!project) return refuse({ refused: "not_found", detail: remoteId });
    if (await sharedOnServer(project.importedAs)) return refuse({ refused: "shared_on_server" });
    return {
      remoteId,
      name: project.name,
      importedAs: project.importedAs,
      stops: stoppingProject(project.importedAs),
    };
  } catch (error) {
    void logError("overleaf ai find live", error);
    throw error;
  }
}

async function openedCopy(remoteId: string): Promise<string | Refusal> {
  const projectId = await openLiveAndRefresh(remoteId);
  if (projectId) return projectId;
  const progress = useOverleafImportStore.getState().progress[remoteId];
  if (progress?.phase !== "failed") return { refused: "busy" };
  throw new Error(describeError(progress.error));
}

function liveElsewhere(params: CollabErrorParams): Refusal {
  if (params.by === "cli") {
    return { refused: "live_elsewhere", detail: params.pid ? `the command line, process ${params.pid}` : "the command line" };
  }
  if (params.by === "app") return { refused: "live_elsewhere", detail: "another Oleafly window" };
  return { refused: "live_elsewhere" };
}

async function resumed(projectId: string): Promise<Refusal | null> {
  try {
    await overleafLiveActions().resume(projectId);
    return null;
  } catch (error) {
    if (!isCollabCommandError(error) || error.code !== "live_elsewhere") throw error;
    return liveElsewhere(collabErrorParams(error));
  }
}

function liveOutcome(projectId: string, state: CollabLiveStoreState): LiveOpened | null {
  if (useFilesStore.getState().projectId !== projectId) return { refused: "project_changed" };
  if (state.projectId !== projectId) return null;
  if (state.share !== null || (state.backend !== null && state.backend !== "overleaf")) {
    return { refused: "shared_on_server" };
  }
  const status = state.status;
  if (status?.state === "online" && state.backend === "overleaf") {
    return { projectId, status: "online", role: state.role };
  }
  if (status?.state !== "ended") return null;
  if (state.refused === "live_elsewhere") return liveElsewhere(state.refusedParams);
  return { refused: "ended", detail: status.reason };
}

function liveSettled(useCollabLiveStore: LiveStore, projectId: string): Promise<LiveOpened> {
  return new Promise((resolve) => {
    const finish = (outcome: LiveOpened) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      const state = useCollabLiveStore.getState();
      const status = state.projectId === projectId ? state.status?.state : null;
      finish({ projectId, status: status ?? "connecting", role: state.projectId === projectId ? state.role : null });
    }, LIVE_WAIT_MS);
    const unsubscribe = useCollabLiveStore.subscribe((state) => {
      const outcome = liveOutcome(projectId, state);
      if (outcome) finish(outcome);
    });
    const now = liveOutcome(projectId, useCollabLiveStore.getState());
    if (now) finish(now);
  });
}

function wake(useCollabLiveStore: LiveStore): void {
  const state = useCollabLiveStore.getState();
  state.goLiveAgain();
  const resting = state.status?.state;
  if (resting !== "idle" && resting !== "offline") return;
  collabLiveReconnectNow().catch((error: unknown) => logError("overleaf ai wake live", error));
}

async function opened(target: LiveTarget, shouldContinue: () => boolean): Promise<LiveOpened> {
  const projectId = target.importedAs ?? (await openedCopy(target.remoteId));
  if (typeof projectId !== "string") return projectId;
  const link = await overleafLiveProject(projectId);
  if (!link) return { refused: "not_linked" };
  if (link.paused) {
    const refusal = await resumed(projectId);
    if (refusal) return refusal;
  }
  const { useCollabLiveStore } = await import("@/features/collab/live/live-store");
  const before = useFilesStore.getState().projectId;
  if (before === projectId) wake(useCollabLiveStore);
  else await useFilesStore.getState().openProject(projectId, shouldContinue);
  const now = useFilesStore.getState().projectId;
  if (now === projectId) return liveSettled(useCollabLiveStore, projectId);
  if (now !== null && now !== before) return { refused: "project_changed" };
  return { refused: shouldContinue() ? "not_opened" : "cancelled" };
}

export async function openLive(target: LiveTarget, shouldContinue: () => boolean): Promise<LiveOpened> {
  if (!useSettingsStore.getState().overleafLive) return refuse({ refused: "switch_off" });
  try {
    const outcome = await opened(target, shouldContinue);
    return "refused" in outcome ? refuse(outcome) : outcome;
  } catch (error) {
    void logError("overleaf ai open live", error);
    throw isCollabCommandError(error) ? new Error(collabErrorText(error)) : error;
  }
}
