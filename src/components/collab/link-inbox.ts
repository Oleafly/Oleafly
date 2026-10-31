import { create } from "zustand";

interface LinkInboxState {
  links: readonly string[];
  add: (link: string) => void;
  take: (count: number) => void;
}

export const useLinkInbox = create<LinkInboxState>((set) => ({
  links: [],
  add: (link) => set((state) => ({ links: [...state.links, link] })),
  take: (count) => set((state) => ({ links: state.links.slice(count) })),
}));
