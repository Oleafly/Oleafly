import { beforeEach, describe, expect, it } from "vitest";
import { subscribeToComputerUseStarts } from "@/lib/agent-item-effects";
import { useAgentTurnsStore } from "@/store/agent-turns";

describe("App agent item effects", () => {
  beforeEach(() => {
    useAgentTurnsStore.getState().reset();
  });

  it("opens the browser only when a computer-use item is newly published", () => {
    let opens = 0;
    const unsubscribe = subscribeToComputerUseStarts(() => {
      opens += 1;
    });
    const store = useAgentTurnsStore.getState();

    try {
      store.beginTurn("chat-1", "thread-1", "turn-1", "inspect the page");
      store.applyEvent("chat-1", {
        kind: "toolCallStart",
        id: "browser-1",
        name: "computer_use",
      });
      expect(opens).toBe(1);

      store.applyEvent("chat-1", { kind: "usage", usage: { input: 7, output: 3 } });
      expect(opens).toBe(1);

      store.applyEvent("chat-1", {
        kind: "toolCallStart",
        id: "read-1",
        name: "read_file",
      });
      expect(opens).toBe(1);

      store.applyEvent("chat-1", {
        kind: "toolCallStart",
        id: "browser-2",
        name: "computer_use",
      });
      expect(opens).toBe(2);
    } finally {
      unsubscribe();
    }
  });
});
