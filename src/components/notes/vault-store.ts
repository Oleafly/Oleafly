import { create } from "zustand";

interface VaultState {
  tag: string | null;
  tagRequest: number;
  switcherOpen: boolean;
}

export const useVaultStore = create<VaultState>(() => ({ tag: null, tagRequest: 0, switcherOpen: false }));

export function filterByTag(tag: string | null): void {
  const key = tag?.trim().replace(/^#+/u, "").toLowerCase() || null;
  useVaultStore.setState((state) => ({ tag: key, tagRequest: key ? state.tagRequest + 1 : state.tagRequest }));
}

export function setQuickSwitcherOpen(open: boolean): void {
  useVaultStore.setState({ switcherOpen: open });
}
