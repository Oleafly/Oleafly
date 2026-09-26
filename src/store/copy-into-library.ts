import { create } from "zustand";
import { i18n } from "@/i18n";
import { decodeAppError, describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import {
  cancelCopyIntoLibrary,
  copyLinkedIntoLibrary,
  type CopiedIntoLibrary,
  type CopyIntoLibraryProgress,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";

export const COPY_CANCELLED = "project.copy_cancelled";

export type CopyIntoLibraryStatus = "idle" | "running" | "cancelling" | "failed";

export interface CopyIntoLibraryOptions {
  openAfterCopy?: boolean;
}

interface CopyTarget {
  projectId: string;
  name: string;
}

interface CopyIntoLibraryState {
  target: CopyTarget | null;
  status: CopyIntoLibraryStatus;
  progress: CopyIntoLibraryProgress | null;
  error: string | null;
  operationId: string | null;
  start: (projectId: string, name: string, options?: CopyIntoLibraryOptions) => Promise<string | null>;
  cancel: () => void;
  close: () => void;
}

const IDLE = {
  target: null,
  status: "idle",
  progress: null,
  error: null,
  operationId: null,
} satisfies Partial<CopyIntoLibraryState>;

function failureMessage(error: unknown, name: string): string {
  if (decodeAppError(error)) return describeError(error);
  return i18n.t(($) => $.library.folder.copy.failed, { name });
}

export const useCopyIntoLibraryStore = create<CopyIntoLibraryState>((set, get) => ({
  ...IDLE,
  start: async (projectId, name, options) => {
    const { status } = get();
    if (status === "running" || status === "cancelling") return null;
    const operationId = crypto.randomUUID();
    set({ target: { projectId, name }, status: "running", progress: null, error: null, operationId });
    const current = () => get().operationId === operationId;
    let copied: CopiedIntoLibrary;
    try {
      copied = await copyLinkedIntoLibrary(projectId, operationId, (progress) => {
        if (current()) set({ progress });
      });
    } catch (error) {
      if (!current()) return null;
      if (decodeAppError(error)?.code === COPY_CANCELLED) {
        set(IDLE);
        return null;
      }
      void logError("copy folder into library", error);
      set({ status: "failed", error: failureMessage(error, name) });
      return null;
    }
    if (current()) set(IDLE);
    const files = useFilesStore.getState();
    await files.refreshProjects().catch((error: unknown) => {
      void logError("refresh projects after copying a folder", error);
    });
    const leftOut =
      copied.leftOut > 0 ? i18n.t(($) => $.library.folder.copy.doneLeftOut, { name }) : null;
    if (options?.openAfterCopy) {
      await files.openProject(copied.projectId);
      toast.success(leftOut ?? i18n.t(($) => $.shell.openedFolder.readOnly.copied));
      return copied.projectId;
    }
    const message = leftOut ?? i18n.t(($) => $.library.folder.copy.done, { name });
    toast.success(message, {
      label: i18n.t(($) => $.common.actions.open),
      onClick: () => {
        void useFilesStore.getState().openProject(copied.projectId);
      },
    });
    return copied.projectId;
  },
  cancel: () => {
    const { operationId, status } = get();
    if (!operationId || status !== "running") return;
    set({ status: "cancelling" });
    void cancelCopyIntoLibrary(operationId).catch((error: unknown) => {
      void logError("cancel copying a folder", error);
    });
  },
  close: () => {
    const { status } = get();
    if (status === "running" || status === "cancelling") return;
    set(IDLE);
  },
}));

export function copyIntoLibrary(
  projectId: string,
  name: string,
  options?: CopyIntoLibraryOptions,
): Promise<string | null> {
  return useCopyIntoLibraryStore.getState().start(projectId, name, options);
}
