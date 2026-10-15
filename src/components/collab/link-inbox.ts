import { create } from "zustand";

interface LinkInboxState {
  // Project links pasted inside the app. They go through the same flow as
  // links opened from outside, so sign-in and unknown servers get the same help.
  links: readonly string[];
  add: (link: string) => void;
  take: (count: number) => void;
}

export const useLinkInbox = create<LinkInboxState>((set) => ({
  links: [],
  add: (link) => set((state) => ({ links: [...state.links, link] })),
  take: (count) => set((state) => ({ links: state.links.slice(count) })),
}));
