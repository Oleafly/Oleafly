import { create } from "zustand";
import type { OpenedFolder } from "@/lib/folder-detection";

interface OpenFolderState {
  opened: OpenedFolder | null;
  present: (opened: OpenedFolder) => void;
  dismiss: () => void;
}

export const useOpenFolderStore = create<OpenFolderState>((set) => ({
  opened: null,
  present: (opened) => set({ opened }),
  dismiss: () => set({ opened: null }),
}));
