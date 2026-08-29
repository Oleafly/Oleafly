import { useAgentTurnsStore } from "@/store/agent-turns";

export function subscribeToComputerUseStarts(openBrowser: () => void): () => void {
  return useAgentTurnsStore.subscribe((state, previous) => {
    if (state.addedItemsByChat === previous.addedItemsByChat) return;
    for (const [chatId, items] of Object.entries(state.addedItemsByChat)) {
      if (items === previous.addedItemsByChat[chatId]) continue;
      for (const recorded of items) {
        const item = recorded.item;
        if (
          item.type === "dynamicToolCall" &&
          item.tool === "computer_use" &&
          item.status === "inProgress"
        ) {
          openBrowser();
        }
      }
    }
  });
}
