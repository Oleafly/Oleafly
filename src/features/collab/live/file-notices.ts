import { create } from "zustand";
import { logError } from "@/lib/log";
import type {
  CollabErrorCode,
  CollabLiveKept,
  CollabLiveKeptFile,
  CollabLiveUploads,
  CollabLocalCopyOffer,
  CollabUploadFile,
  CollabUploadProgress,
} from "@/lib/tauri";
import {
  collabLocalCopyBringIn,
  collabLocalCopyDecline,
  collabLocalCopyOffer,
  collabUploadDismiss,
  collabUploadList,
  collabUploadRetry,
  onCollabDownloadProgress,
  onCollabLiveKept,
  onCollabLiveUploads,
  onCollabUploadProgress,
} from "@/lib/tauri-collab";
import { useFilesStore } from "@/store/files";
import { collabErrorCode } from "../errors";
import { useCollabLiveStore } from "./live-store";

export interface UploadProgress {
  done: number;
  total: number;
}

export interface FileNoticesState {
  projectId: string | null;
  uploads: readonly CollabUploadFile[];
  progress: Readonly<Record<string, UploadProgress>>;
  downloads: Readonly<Record<string, UploadProgress>>;
  kept: readonly CollabLiveKeptFile[];
  retrying: boolean;
  offer: CollabLocalCopyOffer | null;
  bringing: boolean;
  offerFailure: CollabErrorCode | null;
  broughtIn: string | null;
  notAllowed: readonly string[];
  keptAway: readonly string[];
  retry: () => Promise<void>;
  dismissUpload: (path: string) => void;
  dismissKept: (id: string) => void;
  bringIn: () => Promise<void>;
  keepSeparate: () => void;
  dismissBroughtIn: () => void;
  dismissNotAllowed: () => void;
  dismissKeptAway: () => void;
}

export type TreeNoticeKind = "not_allowed" | "kept_away";

const NO_OFFER = { offer: null, bringing: false, offerFailure: null, broughtIn: null } as const;

const NO_UPLOADS: readonly CollabUploadFile[] = [];
const NO_PROGRESS: Readonly<Record<string, UploadProgress>> = {};
const NO_KEPT: readonly CollabLiveKeptFile[] = [];
const NO_PATHS: readonly string[] = [];
const NO_TREE = { notAllowed: NO_PATHS, keptAway: NO_PATHS } as const;

export const useFileNotices = create<FileNoticesState>((set, get) => ({
  projectId: null,
  uploads: NO_UPLOADS,
  progress: NO_PROGRESS,
  downloads: NO_PROGRESS,
  kept: NO_KEPT,
  retrying: false,
  ...NO_OFFER,
  ...NO_TREE,
  retry: async () => {
    const { projectId, retrying } = get();
    if (!projectId || retrying) return;
    set({ retrying: true });
    try {
      await collabUploadRetry(projectId);
    } catch (error) {
      void logError("retry shared figures", error);
    } finally {
      set({ retrying: false });
    }
  },
  dismissUpload: (path) => {
    const { projectId } = get();
    if (!projectId) return;
    set((state) => ({ uploads: state.uploads.filter((file) => file.path !== path) }));
    void collabUploadDismiss(projectId, path).catch((error) => logError("dismiss a figure notice", error));
  },
  dismissKept: (id) => set((state) => ({ kept: state.kept.filter((file) => file.id !== id) })),
  bringIn: async () => {
    const { projectId, offer, bringing } = get();
    if (!projectId || !offer || bringing) return;
    set({ bringing: true, offerFailure: null });
    try {
      await collabLocalCopyBringIn(projectId, offer.copyId);
    } catch (error) {
      if (get().projectId === projectId) set({ bringing: false, offerFailure: collabErrorCode(error) });
      return;
    }
    if (get().projectId !== projectId) return;
    set({ offer: null, bringing: false, broughtIn: offer.name });
  },
  keepSeparate: () => {
    const { projectId, offer, bringing } = get();
    if (!projectId || !offer || bringing) return;
    set({ offer: null, offerFailure: null });
    void collabLocalCopyDecline(projectId, offer.copyId).catch((error) =>
      logError("keep a local copy separate", error),
    );
  },
  dismissBroughtIn: () => set({ broughtIn: null }),
  dismissNotAllowed: () => set({ notAllowed: NO_PATHS }),
  dismissKeptAway: () => set({ keptAway: NO_PATHS }),
}));

export function withPaths(known: readonly string[], paths: readonly string[]): readonly string[] {
  const added = paths.filter((path) => !known.includes(path));
  return added.length === 0 ? known : [...known, ...added];
}

export function treeNoticed(projectId: string, kind: TreeNoticeKind, paths: readonly string[]): void {
  if (useFilesStore.getState().projectId !== projectId) return;
  const key = kind === "not_allowed" ? "notAllowed" : "keptAway";
  useFileNotices.setState((state) =>
    state.projectId === projectId
      ? { [key]: withPaths(state[key], paths) }
      : { projectId, uploads: NO_UPLOADS, progress: NO_PROGRESS, downloads: NO_PROGRESS, kept: NO_KEPT, ...NO_TREE, [key]: paths },
  );
}

function stillWaiting(
  progress: Readonly<Record<string, UploadProgress>>,
  files: readonly CollabUploadFile[],
): Readonly<Record<string, UploadProgress>> {
  const kept = Object.entries(progress).filter(([path]) =>
    files.some((file) => file.path === path && file.state === "waiting"),
  );
  return kept.length === Object.keys(progress).length ? progress : Object.fromEntries(kept);
}

function uploaded(payload: CollabLiveUploads): void {
  if (useFilesStore.getState().projectId !== payload.projectId) return;
  useFileNotices.setState((state) => {
    const same = state.projectId === payload.projectId;
    return {
      projectId: payload.projectId,
      uploads: payload.files,
      progress: same ? stillWaiting(state.progress, payload.files) : NO_PROGRESS,
      kept: same ? state.kept : NO_KEPT,
    };
  });
}

function withProgress(
  known: Readonly<Record<string, UploadProgress>>,
  payload: CollabUploadProgress,
): Readonly<Record<string, UploadProgress>> {
  if (payload.total > 0 && payload.done < payload.total) {
    return { ...known, [payload.path]: { done: payload.done, total: payload.total } };
  }
  const { [payload.path]: _finished, ...rest } = known;
  return rest;
}

function progressed(payload: CollabUploadProgress): void {
  if (useFilesStore.getState().projectId !== payload.projectId) return;
  useFileNotices.setState((state) => ({
    projectId: payload.projectId,
    progress: withProgress(state.projectId === payload.projectId ? state.progress : NO_PROGRESS, payload),
  }));
}

function downloaded(payload: CollabUploadProgress): void {
  if (useFilesStore.getState().projectId !== payload.projectId) return;
  useFileNotices.setState((state) => ({
    projectId: payload.projectId,
    downloads: withProgress(state.projectId === payload.projectId ? state.downloads : NO_PROGRESS, payload),
  }));
}

function keptCopies(payload: CollabLiveKept): void {
  if (useFilesStore.getState().projectId !== payload.projectId) return;
  const live = useCollabLiveStore.getState();
  const unknown = payload.files.some(
    (file) => file.by && !live.members.some((member) => member.person.account_id === file.by),
  );
  if (unknown) void live.refreshMembers();
  useFileNotices.setState((state) => {
    const same = state.projectId === payload.projectId;
    const earlier = same
      ? state.kept.filter((existing) => !payload.files.some((file) => file.id === existing.id))
      : NO_KEPT;
    return {
      projectId: payload.projectId,
      kept: [...payload.files, ...earlier],
      uploads: same ? state.uploads : NO_UPLOADS,
    };
  });
}

function load(projectId: string | null): void {
  useFileNotices.setState({
    projectId,
    uploads: NO_UPLOADS,
    progress: NO_PROGRESS,
    downloads: NO_PROGRESS,
    kept: NO_KEPT,
    retrying: false,
    ...NO_OFFER,
    ...NO_TREE,
  });
  if (!projectId) return;
  collabUploadList(projectId).then(
    (files) => {
      if (useFileNotices.getState().projectId === projectId) useFileNotices.setState({ uploads: files });
    },
    (error) => void logError("list shared figures", error),
  );
  collabLocalCopyOffer(projectId).then(
    (offer) => {
      if (useFileNotices.getState().projectId === projectId) useFileNotices.setState({ offer });
    },
    (error) => void logError("look for local copy changes", error),
  );
}

export function startFileNotices(): () => void {
  const stopUploads = onCollabLiveUploads(uploaded).catch((error) => {
    void logError("collab uploads listen", error);
    return () => {};
  });
  const stopKept = onCollabLiveKept(keptCopies).catch((error) => {
    void logError("collab kept listen", error);
    return () => {};
  });
  const stopProgress = onCollabUploadProgress(progressed).catch((error) => {
    void logError("collab upload progress listen", error);
    return () => {};
  });
  const stopDownloads = onCollabDownloadProgress(downloaded).catch((error) => {
    void logError("collab download progress listen", error);
    return () => {};
  });
  let projectId = useFilesStore.getState().projectId;
  load(projectId);
  const stopFiles = useFilesStore.subscribe((state) => {
    if (state.projectId === projectId) return;
    projectId = state.projectId;
    load(projectId);
  });
  return () => {
    stopFiles();
    void stopUploads.then((stop) => stop());
    void stopKept.then((stop) => stop());
    void stopProgress.then((stop) => stop());
    void stopDownloads.then((stop) => stop());
    useFileNotices.setState({
      projectId: null,
      uploads: NO_UPLOADS,
      progress: NO_PROGRESS,
      downloads: NO_PROGRESS,
      kept: NO_KEPT,
      retrying: false,
      ...NO_OFFER,
      ...NO_TREE,
    });
  };
}
