import { create } from "zustand";

interface AddServerRequest {
  url: string | null;
  ask: (url: string) => void;
  take: () => string | null;
}

export const useAddServerRequest = create<AddServerRequest>((set, get) => ({
  url: null,
  ask: (url) => set({ url }),
  take: () => {
    const url = get().url;
    if (url !== null) set({ url: null });
    return url;
  },
}));
