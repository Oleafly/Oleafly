import { create } from "zustand";

export interface TreeClashState {
  labels: ReadonlyMap<string, string>;
}

export const useTreeClashes = create<TreeClashState>(() => ({ labels: new Map() }));
