import { create } from "zustand";

interface VaultState {
  tag: string | null;
  tagRequest: number;
  switcherOpen: boolean;
  searchRequest: number;
}

export const useVaultStore = create<VaultState>(() => ({ tag: null, tagRequest: 0, switcherOpen: false, searchRequest: 0 }));

export function focusNotesSearch(): void {
  useVaultStore.setState((state) => ({ searchRequest: state.searchRequest + 1 }));
}

export function filterByTag(tag: string | null): void {
  const key = tag?.trim().replace(/^#+/u, "").toLowerCase() || null;
  useVaultStore.setState((state) => ({ tag: key, tagRequest: key ? state.tagRequest + 1 : state.tagRequest }));
}

export function setQuickSwitcherOpen(open: boolean): void {
  useVaultStore.setState({ switcherOpen: open });
}
