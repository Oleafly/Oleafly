import { create } from "zustand";

/**
 * Screenshot mode: while `hidden` is on, paths, account names and chosen counts
 * get a light blur (see src/components/ui/private.tsx). It lasts for this
 * session only, like offline mode, so nothing is written to storage.
 */
export const HIDE_PERSONAL_DETAILS_ATTRIBUTE = "data-hide-personal-details";

interface PersonalDetailsState {
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
}

function markDocument(hidden: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.toggleAttribute(HIDE_PERSONAL_DETAILS_ATTRIBUTE, hidden);
}

export const usePersonalDetailsStore = create<PersonalDetailsState>((set) => ({
  hidden: false,
  setHidden: (hidden) => {
    markDocument(hidden);
    set({ hidden });
  },
}));

export function togglePersonalDetails(): void {
  const state = usePersonalDetailsStore.getState();
  state.setHidden(!state.hidden);
}
