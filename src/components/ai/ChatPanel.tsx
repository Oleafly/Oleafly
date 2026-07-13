import { ChatCore } from "@/components/ai/ChatCore";

/** Docked rail host for the assistant. The overlay host renders the same
 *  ChatCore; exactly one is mounted at a time (see the floating store). */
export function ChatPanel() {
  return <ChatCore />;
}
