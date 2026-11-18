import { create } from "zustand";
import { useSettingsStore } from "@/store/settings";

interface ChatRailState {
  visible: boolean;
  unread: boolean;
  reveal: string | null;
}

export const useChatRail = create<ChatRailState>(() => ({ visible: false, unread: false, reveal: null }));

export function openChatMessage(messageId: string): void {
  useChatRail.setState({ reveal: messageId });
  const settings = useSettingsStore.getState();
  settings.setRailTab("chat");
  if (!settings.showTree) settings.setShowTree(true);
}
