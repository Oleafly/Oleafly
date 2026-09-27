import { create } from "zustand";
import { i18n } from "@/i18n";
import { decodeAppError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import {
  projectFolderStatus,
  projectTrustState,
  trustFolder,
  type FolderStatus,
  type ProjectTrust,
  type TrustScope,
} from "@/lib/tauri";
import { notifyError } from "@/lib/toast";

type TerminalStart = "unsettled" | "limited";

interface FolderAccessState {
  projectId: string | null;
  loaded: boolean;
  trust: ProjectTrust | null;
  status: FolderStatus | null;
  trusting: TrustScope | null;
  bannerHidden: boolean;
  hiddenBanners: readonly string[];
  limitedTerminals: Readonly<Record<string, TerminalStart>>;
  reset: (projectId: string | null) => void;
  refreshTrust: (projectId: string) => Promise<void>;
  grant: (scope: TrustScope) => Promise<boolean>;
  hideBanner: () => void;
  noteTerminalStarted: (projectId: string, terminalId: string) => void;
  forgetTerminal: (terminalId: string) => void;
}

type FolderAccessView = Pick<FolderAccessState, "projectId" | "trust" | "status">;

function settleTerminals(
  terminals: Readonly<Record<string, TerminalStart>>,
  trust: ProjectTrust | null,
): Readonly<Record<string, TerminalStart>> {
  if (!trust) return terminals;
  const settled: Record<string, TerminalStart> = {};
  for (const [id, start] of Object.entries(terminals)) {
    if (start === "limited" || !trust.trusted) settled[id] = "limited";
  }
  return settled;
}

function withTrust(
  state: Pick<FolderAccessState, "limitedTerminals">,
  trust: ProjectTrust | null,
): Pick<FolderAccessState, "trust" | "limitedTerminals"> {
  return { trust, limitedTerminals: settleTerminals(state.limitedTerminals, trust) };
}

async function quietly<T>(scope: string, request: () => Promise<T>): Promise<T | null> {
  try {
    return await request();
  } catch (error) {
    void logError(scope, error);
    return null;
  }
}

export const useFolderAccessStore = create<FolderAccessState>((set, get) => ({
  projectId: null,
  loaded: false,
  trust: null,
  status: null,
  trusting: null,
  bannerHidden: false,
  hiddenBanners: [],
  limitedTerminals: {},
  reset: (projectId) =>
    set((state) => ({
      projectId,
      loaded: false,
      trust: null,
      status: projectId !== null && projectId === state.projectId ? state.status : null,
      trusting: null,
      bannerHidden: projectId !== null && state.hiddenBanners.includes(projectId),
      limitedTerminals:
        projectId !== null && projectId === state.projectId ? state.limitedTerminals : {},
    })),
  refreshTrust: async (projectId) => {
    if (get().projectId !== projectId) return;
    const trust = await quietly("read folder trust", () => projectTrustState(projectId));
    if (trust && get().projectId === projectId) set((state) => withTrust(state, trust));
  },
  grant: async (scope) => {
    const { projectId, trusting } = get();
    if (!projectId || trusting) return false;
    set({ trusting: scope });
    try {
      const trust = await trustFolder(projectId, scope);
      if (get().projectId === projectId) set((state) => withTrust(state, trust));
      return trust.trusted;
    } catch (error) {
      if (decodeAppError(error)?.code !== "trust.declined" && get().projectId === projectId) {
        notifyError(
          "trust folder",
          error,
          decodeAppError(error) ? undefined : i18n.t(($) => $.shell.openedFolder.trust.failed),
        );
      }
      return false;
    } finally {
      if (get().projectId === projectId) set({ trusting: null });
    }
  },
  noteTerminalStarted: (projectId, terminalId) => {
    const state = get();
    if (state.projectId !== projectId || state.trust?.trusted === true) return;
    set({
      limitedTerminals: {
        ...state.limitedTerminals,
        [terminalId]: state.trust ? "limited" : "unsettled",
      },
    });
  },
  forgetTerminal: (terminalId) => {
    const { limitedTerminals } = get();
    if (!(terminalId in limitedTerminals)) return;
    const { [terminalId]: _forgotten, ...rest } = limitedTerminals;
    set({ limitedTerminals: rest });
  },
  hideBanner: () => {
    const { projectId, hiddenBanners } = get();
    if (!projectId) return;
    set({
      bannerHidden: true,
      hiddenBanners: hiddenBanners.includes(projectId) ? hiddenBanners : [...hiddenBanners, projectId],
    });
  },
}));

async function readFolderStatus(projectId: string): Promise<FolderStatus | null | undefined> {
  try {
    return await projectFolderStatus(projectId);
  } catch (error) {
    void logError("read folder status", error);
    return undefined;
  }
}

function sameStatus(left: FolderStatus | null, right: FolderStatus | null): boolean {
  return left?.read_only === right?.read_only && left?.synced_with === right?.synced_with;
}

export async function loadFolderAccess(projectId: string): Promise<void> {
  useFolderAccessStore.getState().reset(projectId);
  const [trust, status] = await Promise.all([
    quietly("read folder trust", () => projectTrustState(projectId)),
    readFolderStatus(projectId),
  ]);
  if (useFolderAccessStore.getState().projectId !== projectId) return;
  useFolderAccessStore.setState((state) => ({
    ...withTrust(state, trust),
    status: status === undefined || sameStatus(state.status, status) ? state.status : status,
    loaded: true,
  }));
}

let statusRefresh: { projectId: string; request: Promise<void> } | null = null;

export function refreshFolderStatus(projectId: string): Promise<void> {
  if (statusRefresh?.projectId === projectId) return statusRefresh.request;
  const request = readFolderStatus(projectId)
    .then((status) => {
      const state = useFolderAccessStore.getState();
      if (status === undefined || state.projectId !== projectId || sameStatus(state.status, status)) return;
      useFolderAccessStore.setState({ status });
    })
    .finally(() => {
      if (statusRefresh?.request === request) statusRefresh = null;
    });
  statusRefresh = { projectId, request };
  return request;
}

export function folderIsRestricted(state: FolderAccessView, projectId: string | null): boolean {
  return projectId !== null && state.projectId === projectId && state.trust?.trusted === false;
}

export function terminalNeedsReopen(
  state: Pick<FolderAccessState, "projectId" | "trust" | "limitedTerminals">,
  projectId: string | null,
  terminalId: string | null,
): boolean {
  return (
    projectId !== null &&
    terminalId !== null &&
    state.projectId === projectId &&
    state.trust?.trusted === true &&
    state.limitedTerminals[terminalId] === "limited"
  );
}

export function folderIsReadOnly(state: FolderAccessView, projectId: string | null): boolean {
  return projectId !== null && state.projectId === projectId && state.status?.read_only === true;
}

export function projectFolderIsReadOnly(projectId: string | null): boolean {
  return folderIsReadOnly(useFolderAccessStore.getState(), projectId);
}

export function useProjectFolderReadOnly(projectId: string | null): boolean {
  return useFolderAccessStore((state) => folderIsReadOnly(state, projectId));
}

export function readOnlyFolderMessage(): string {
  return i18n.t(($) => $.shell.openedFolder.readOnly.banner);
}

export function readOnlyFolderMessageInEnglish(): string {
  return i18n.getFixedT("en", ["common", "shell"])(($) => $.shell.openedFolder.readOnly.banner);
}
