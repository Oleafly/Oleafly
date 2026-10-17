import { create } from "zustand";

export interface FileRenameTarget {
  readonly path: string;
  readonly directory: boolean;
}

interface FileRenameState {
  target: FileRenameTarget | null;
  open: (target: FileRenameTarget) => void;
  close: () => void;
}

export const useFileRenameStore = create<FileRenameState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));
