import { create } from "zustand";
import type { OpenedFolder } from "@/lib/folder-detection";

interface OpenFolderState {
  opened: OpenedFolder | null;
  changing: boolean;
  present: (opened: OpenedFolder, changing?: boolean) => void;
  dismiss: () => void;
}

export const useOpenFolderStore = create<OpenFolderState>((set) => ({
  opened: null,
  changing: false,
  present: (opened, changing = false) => set({ opened, changing }),
  dismiss: () => set({ opened: null, changing: false }),
}));
