import { listen } from "@tauri-apps/api/event";
import { i18n } from "@/i18n";
import { activeChatRun } from "@/components/ai/chat-run-registry";
import { decodeAppError, describeError } from "@/lib/app-error";
import { holdBootSplash, releaseBootSplash } from "@/lib/boot-telemetry";
import { offerQuickActionOnce } from "@/features/quick-action-offer";
import type { OpenedFolder } from "@/lib/folder-detection";
import { logError } from "@/lib/log";
import { usesNativeDockMenu } from "@/lib/native-dock-shortcuts";
import {
  beginOpenSession,
  discardOpenRequest,
  openFolderRequest,
  pendingOpenRequests,
  pickOpenFolder,
  prepareOpenRequest,
  setRecentProjects,
  type OpenRequestPreview,
  type PendingOpenRequest,
  type ProjectInfo,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { isMac, isWindows } from "@/lib/utils";
import { useCompileStore } from "@/store/compile";
import { onSaveBlockedSettled, useFilesStore, type SaveBlockedState } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useOpenFolderStore } from "@/store/open-folder";
import { useOpenFolderFlowStore } from "@/store/open-folder-flow";
import { useTourStore } from "@/store/tours";

export type OpenFolderOutcome =
  | "opened"
  | "focused"
  | "declined"
  | "refused"
  | "blocked"
  | "failed"
  | "cancelled";

export const OPEN_REQUEST_EVENT = "open-request";
export const OPEN_FOLDER_MENU_EVENT = "menu://open-folder";
export const OPEN_RECENT_MENU_EVENT = "menu://open-recent";
const RECENT_MENU_LIMIT = 10;
const PERMISSION_DENIED = "open_folder.permission_denied";
const TOO_BROAD = "open_folder.too_broad";

const handledTokens = new Set<string>();
let draining: Promise<void> | null = null;
let drainAgain = false;
let session: number | null = null;
let sessionStart: Promise<void> | null = null;

interface RunningWork {
  compile: boolean;
  assistant: boolean;
}

export function prepareColdOpen(pending: readonly PendingOpenRequest[]): void {
  const newest = pending.at(-1);
  if (!newest) return;
  holdBootSplash(i18n.t(($) => $.shell.splash.opening, { name: newest.display_name }));
}

export async function openPendingRequest(request: PendingOpenRequest): Promise<OpenFolderOutcome> {
  const flow = useOpenFolderFlowStore.getState();
  flow.clearRefusal();
  flow.setOpening(true);
  try {
    const cleared = await clearRunningWork(request);
    if (cleared !== "clear") return cleared;
    let folder: OpenedFolder;
    try {
      folder = await openFolderRequest(request.token, session);
    } catch (error) {
      reportRefusal(error, request.display_name);
      return "refused";
    }
    return await switchToFolder(folder);
  } finally {
    useOpenFolderFlowStore.getState().setOpening(false);
  }
}

export async function openFolderWithPicker(browse: string | null = null): Promise<OpenFolderOutcome> {
  if (useOpenFolderFlowStore.getState().opening) return "cancelled";
  let picked: PendingOpenRequest | null;
  try {
    picked = await pickOpenFolder(browse);
  } catch (error) {
    reportRefusal(error, null);
    return "refused";
  }
  if (!picked) return "cancelled";
  const outcome = await openPendingRequest(picked);
  if (outcome === "opened" || outcome === "focused") void offerQuickActionOnce();
  return outcome;
}

export async function openRecentProject(projectId: string): Promise<void> {
  const files = useFilesStore.getState();
  if (files.projectId === projectId) return;
  const name = files.projects.find((project) => project.id === projectId)?.name ?? projectId;
  if (!(await stopRunningWork(name))) return;
  await useFilesStore.getState().openProject(projectId);
}

export function drainOpenRequests(): Promise<void> {
  if (draining) {
    drainAgain = true;
    return draining;
  }
  draining = (async () => {
    try {
      do {
        drainAgain = false;
        const fresh = (await pendingOpenRequests()).filter(
          (request) => !handledTokens.has(request.token),
        );
        for (const request of fresh) handledTokens.add(request.token);
        const newest = fresh.at(-1);
        if (newest) await openPendingRequest(newest);
      } while (drainAgain);
    } catch (error) {
      void logError("open requested folders", error);
    } finally {
      draining = null;
      releaseBootSplash();
    }
  })();
  return draining;
}

function startOpenSession(): Promise<void> {
  sessionStart ??= beginOpenSession().then(
    (started) => {
      session = started;
    },
    (error) => {
      sessionStart = null;
      void logError("start taking folder requests", error);
    },
  );
  return sessionStart;
}

export async function startOpenRequestIntake(): Promise<() => void> {
  await startOpenSession();
  const stops = await Promise.all([
    listen(OPEN_REQUEST_EVENT, () => void drainOpenRequests()),
    listen(OPEN_FOLDER_MENU_EVENT, () => {
      if (!useTourStore.getState().activeTourId) void openFolderWithPicker();
    }),
    listen<unknown>(OPEN_RECENT_MENU_EVENT, (event) => {
      if (typeof event.payload === "string") void openRecentProject(event.payload);
    }),
  ]);
  void drainOpenRequests();
  return () => {
    for (const stop of stops) stop();
  };
}

export function startRecentProjectsMenuSync(enabled = usesNativeDockMenu()): () => void {
  if (!enabled) return () => {};
  let sent = "";
  const sync = (projects: readonly ProjectInfo[]) => {
    const recent = [...projects]
      .sort((left, right) => right.updated_at - left.updated_at)
      .slice(0, RECENT_MENU_LIMIT)
      .map(({ id, name }) => ({ id, name }));
    const key = JSON.stringify(recent);
    if (key === sent) return;
    sent = key;
    void setRecentProjects(recent).catch((error) => {
      void logError("update the Open Recent menu", error);
    });
  };
  sync(useFilesStore.getState().projects);
  return useFilesStore.subscribe((state, previous) => {
    if (state.projects !== previous.projects) sync(state.projects);
  });
}

async function clearRunningWork(
  request: PendingOpenRequest,
): Promise<"clear" | "declined" | "refused"> {
  if (!runningWork()) return "clear";
  let preview: OpenRequestPreview;
  try {
    preview = await prepareOpenRequest(request.token, session);
  } catch (error) {
    reportRefusal(error, request.display_name);
    return "refused";
  }
  const shown = useFilesStore.getState().projectId;
  if (preview.project_id !== null && preview.project_id === shown) return "clear";
  if (await stopRunningWork(preview.display_name)) return "clear";
  void discardOpenRequest(request.token, session).catch((error) => {
    void logError("decline a folder request", error);
  });
  return "declined";
}

async function switchToFolder(folder: OpenedFolder): Promise<OpenFolderOutcome> {
  const target = folder.project_id;
  if (useFilesStore.getState().projectId === target) {
    useOpenFolderStore.getState().present(folder);
    return "focused";
  }
  await useFilesStore.getState().openProject(target);
  void useFilesStore
    .getState()
    .refreshProjects()
    .catch((error) => void logError("refresh projects after opening a folder", error));
  const files = useFilesStore.getState();
  if (files.projectId === target && !files.saveBlocked) {
    useOpenFolderStore.getState().present(folder);
    return "opened";
  }
  if (files.saveBlocked?.targetProjectId === target) {
    presentOnceOpen(folder, files.saveBlocked);
    return "blocked";
  }
  return "failed";
}

function presentOnceOpen(folder: OpenedFolder, blocked: SaveBlockedState): void {
  const stop = onSaveBlockedSettled((settled, left) => {
    stop();
    if (settled !== blocked || !left) return;
    if (useFilesStore.getState().projectId === folder.project_id) {
      useOpenFolderStore.getState().present(folder);
    }
  });
}

function runningWork(): RunningWork | null {
  if (!useFilesStore.getState().projectId) return null;
  const compile = useCompileStore.getState().status === "compiling";
  const assistant = activeChatRun() !== null;
  return compile || assistant ? { compile, assistant } : null;
}

async function stopRunningWork(name: string): Promise<boolean> {
  const work = runningWork();
  if (!work) return true;
  const stop = await useOpenFolderFlowStore
    .getState()
    .ask({ name, project: useFilesStore.getState().projectName, ...work });
  if (!stop) return false;
  if (work.compile) await useCompileStore.getState().stopCompile();
  if (work.assistant) activeChatRun()?.controller.abort();
  return true;
}

function permissionHint(): string {
  if (isMac) return i18n.t(($) => $.shell.openFolder.permissionHint.mac);
  if (isWindows) return i18n.t(($) => $.shell.openFolder.permissionHint.windows);
  return i18n.t(($) => $.shell.openFolder.permissionHint.linux);
}

function reportRefusal(error: unknown, requested: string | null): void {
  void logError("open folder", error);
  const app = decodeAppError(error);
  const message = describeError(error);
  const hint = app?.code === PERMISSION_DENIED ? permissionHint() : null;
  const browse = app?.params.browse ?? null;
  const name = app?.code === TOO_BROAD ? null : requested;
  const title = name ? i18n.t(($) => $.shell.openFolder.refusedTitle, { name }) : null;
  if (!useFilesStore.getState().projectId && useHomeViewStore.getState().page === "library") {
    useOpenFolderFlowStore.getState().refuse({ title, message, hint, browse });
    return;
  }
  const reason = hint
    ? i18n.t(($) => $.shell.openFolder.reasonWithHint, { reason: message, hint })
    : message;
  toast.errorUnique(
    `open-folder:${app?.code ?? "failed"}`,
    name ? i18n.t(($) => $.shell.openFolder.refused, { name, reason }) : reason,
    browse
      ? {
          label: i18n.t(($) => $.shell.openFolder.chooseSubfolder),
          onClick: () => void openFolderWithPicker(browse),
        }
      : undefined,
    hint !== null,
  );
}
