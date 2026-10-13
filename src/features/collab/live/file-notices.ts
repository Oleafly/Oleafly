import { create } from "zustand";
import { logError } from "@/lib/log";
import {
  collabLocalCopyBringIn,
  collabLocalCopyDecline,
  collabLocalCopyOffer,
  collabUploadDismiss,
  collabUploadList,
  collabUploadRetry,
  onCollabLiveKept,
  onCollabLiveUploads,
  type CollabErrorCode,
  type CollabLiveKept,
  type CollabLiveKeptFile,
  type CollabLiveUploads,
  type CollabLocalCopyOffer,
  type CollabUploadFile,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { collabErrorCode } from "../errors";
import { useCollabLiveStore } from "./live-store";

export interface FileNoticesState {
  projectId: string | null;
  uploads: readonly CollabUploadFile[];
  kept: readonly CollabLiveKeptFile[];
  retrying: boolean;
  offer: CollabLocalCopyOffer | null;
  bringing: boolean;
  offerFailure: CollabErrorCode | null;
  broughtIn: string | null;
  retry: () => Promise<void>;
  dismissUpload: (path: string) => void;
  dismissKept: (id: string) => void;
  bringIn: () => Promise<void>;
  keepSeparate: () => void;
  dismissBroughtIn: () => void;
}

const NO_OFFER = { offer: null, bringing: false, offerFailure: null, broughtIn: null } as const;

const NO_UPLOADS: readonly CollabUploadFile[] = [];
const NO_KEPT: readonly CollabLiveKeptFile[] = [];

export const useFileNotices = create<FileNoticesState>((set, get) => ({
  projectId: null,
  uploads: NO_UPLOADS,
  kept: NO_KEPT,
  retrying: false,
  ...NO_OFFER,
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
}));

function uploaded(payload: CollabLiveUploads): void {
  if (useFilesStore.getState().projectId !== payload.projectId) return;
  useFileNotices.setState((state) => ({
    projectId: payload.projectId,
    uploads: payload.files,
    kept: state.projectId === payload.projectId ? state.kept : NO_KEPT,
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
  useFileNotices.setState({ projectId, uploads: NO_UPLOADS, kept: NO_KEPT, retrying: false, ...NO_OFFER });
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
    useFileNotices.setState({ projectId: null, uploads: NO_UPLOADS, kept: NO_KEPT, retrying: false, ...NO_OFFER });
  };
}
