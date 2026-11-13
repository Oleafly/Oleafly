import { create } from "zustand";
import { readString, writeString } from "@/lib/local-storage";
import type { QuickCaptureStatus } from "@/lib/tauri";

const ENABLED_KEY = "oleafly.notes.quickCapture";

interface QuickCaptureState {
  enabled: boolean;
  status: QuickCaptureStatus | null;
  setEnabled: (enabled: boolean) => void;
  setStatus: (status: QuickCaptureStatus | null) => void;
}

export const useQuickCaptureStore = create<QuickCaptureState>((set) => ({
  enabled: readString(ENABLED_KEY) !== "0",
  status: null,
  setEnabled: (enabled) => {
    writeString(ENABLED_KEY, enabled ? "1" : "0");
    set({ enabled });
  },
  setStatus: (status) => set({ status }),
}));
