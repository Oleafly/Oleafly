import { create } from "zustand";

interface CollabRailState {
  visible: boolean;
  unread: boolean;
}

export const useCollabRail = create<CollabRailState>(() => ({ visible: false, unread: false }));
