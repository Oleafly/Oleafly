import { create } from "zustand";

export interface OpenFolderStopPrompt {
  name: string;
  project: string;
  compile: boolean;
  assistant: boolean;
}

export interface OpenFolderRefusal {
  title: string | null;
  message: string;
  hint: string | null;
  browse: string | null;
}

interface OpenFolderFlowState {
  prompt: OpenFolderStopPrompt | null;
  refusal: OpenFolderRefusal | null;
  opening: boolean;
  ask: (prompt: OpenFolderStopPrompt) => Promise<boolean>;
  answer: (stop: boolean) => void;
  refuse: (refusal: OpenFolderRefusal) => void;
  clearRefusal: () => void;
  setOpening: (opening: boolean) => void;
}

let settlePrompt: ((stop: boolean) => void) | null = null;

export const useOpenFolderFlowStore = create<OpenFolderFlowState>((set) => ({
  prompt: null,
  refusal: null,
  opening: false,
  ask: (prompt) => {
    settlePrompt?.(false);
    set({ prompt });
    return new Promise<boolean>((resolve) => {
      settlePrompt = resolve;
    });
  },
  answer: (stop) => {
    const settle = settlePrompt;
    settlePrompt = null;
    set({ prompt: null });
    settle?.(stop);
  },
  refuse: (refusal) => set({ refusal }),
  clearRefusal: () => set({ refusal: null }),
  setOpening: (opening) => set({ opening }),
}));
