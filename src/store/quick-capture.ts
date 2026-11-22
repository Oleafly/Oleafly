import { create } from "zustand";
import { readString, writeString } from "@/lib/local-storage";
import type { QuickCaptureStatus } from "@/lib/tauri";

const ENABLED_KEY = "oleafly.notes.quickCapture";
const BACKGROUND_KEY = "oleafly.notes.quickCapture.background";

interface QuickCaptureState {
  enabled: boolean;
  background: boolean;
  status: QuickCaptureStatus | null;
  setEnabled: (enabled: boolean) => void;
  setBackground: (background: boolean) => void;
  setStatus: (status: QuickCaptureStatus | null) => void;
}

export const useQuickCaptureStore = create<QuickCaptureState>((set) => ({
  enabled: readString(ENABLED_KEY) !== "0",
  background: readString(BACKGROUND_KEY) === "1",
  status: null,
  setEnabled: (enabled) => {
    writeString(ENABLED_KEY, enabled ? "1" : "0");
    set({ enabled });
  },
  setBackground: (background) => {
    writeString(BACKGROUND_KEY, background ? "1" : "0");
    set({ background });
  },
  setStatus: (status) => set({ status }),
}));
