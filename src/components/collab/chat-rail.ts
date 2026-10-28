import { create } from "zustand";

interface ChatRailState {
  visible: boolean;
  unread: boolean;
}

export const useChatRail = create<ChatRailState>(() => ({ visible: false, unread: false }));
