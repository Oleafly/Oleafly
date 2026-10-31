import { create } from "zustand";

interface ShareDialogState {
  projectId: string | null;
  fromCopy: boolean;
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
