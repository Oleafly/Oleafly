import { create } from "zustand";

interface ShareDialogState {
  projectId: string | null;
  fromCopy: boolean;
  // True while a project's files are being uploaded. The upload keeps running
  // in the backend if the dialog goes away, and sharing again would create a
  // second server project, so the dialog stays open until it finishes.
  sharing: boolean;
  openFor: (projectId: string, fromCopy?: boolean) => void;
  close: () => void;
  setSharing: (sharing: boolean) => void;
}

export const useShareDialog = create<ShareDialogState>((set) => ({
  projectId: null,
  fromCopy: false,
  sharing: false,
  openFor: (projectId, fromCopy = false) => set({ projectId, fromCopy }),
  close: () => set((state) => (state.sharing ? state : { projectId: null, fromCopy: false })),
  setSharing: (sharing) => set({ sharing }),
}));
