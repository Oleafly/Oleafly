import { create } from "zustand";

interface ShareDialogState {
  projectId: string | null;
  fromCopy: boolean;
  openFor: (projectId: string, fromCopy?: boolean) => void;
  close: () => void;
}

export const useShareDialog = create<ShareDialogState>((set) => ({
  projectId: null,
  fromCopy: false,
  openFor: (projectId, fromCopy = false) => set({ projectId, fromCopy }),
  close: () => set({ projectId: null, fromCopy: false }),
}));
