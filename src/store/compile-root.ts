import { create } from "zustand";
import type { LatexUnits } from "@/lib/project-intelligence/types";
import { readStoredFlag, storeFlag } from "@/lib/stored-flag";

const FOLLOW_OPEN_FILE_KEY = "oleafly:compile:follow-open-file";

export interface ProjectLatexUnits {
  readonly projectId: string;
  readonly units: LatexUnits;
}

interface CompileRootState {
  followOpenFile: boolean;
  setFollowOpenFile: (follow: boolean) => void;
  latexUnits: ProjectLatexUnits | null;
  setLatexUnits: (latexUnits: ProjectLatexUnits | null) => void;
}

export const useCompileRootStore = create<CompileRootState>((set) => ({
  followOpenFile: readStoredFlag(FOLLOW_OPEN_FILE_KEY, true),
  setFollowOpenFile: (followOpenFile) => {
    storeFlag(FOLLOW_OPEN_FILE_KEY, followOpenFile);
    set({ followOpenFile });
  },
  latexUnits: null,
  setLatexUnits: (latexUnits) => set({ latexUnits }),
}));
