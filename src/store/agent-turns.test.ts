import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentTurnsStore } from "./agent-turns";

describe("useAgentTurnsStore", () => {
  beforeEach(() => {
    useAgentTurnsStore.getState().reset();
  });

  it("begins an optimistic turn with the user message and folds events", () => {
    const store = useAgentTurnsStore.getState();
    store.beginTurn("chat-1", "thread-1", "client-1", "fix the bibfile");
    store.applyEvent("chat-1", { kind: "textDelta", text: "On it" });
    store.applyEvent("chat-1", { kind: "usage", usage: { input: 5, output: 2 } });
    store.finishTurn("chat-1", false);

    const records = useAgentTurnsStore.getState().recordsByChat["chat-1"];
    expect(records).toHaveLength(1);
    expect(records[0].clientTurnId).toBe("client-1");
    expect(records[0].status).toBe("completed");
    expect(records[0].items[0].item).toEqual({ type: "userMessage", text: "fix the bibfile" });
    expect(records[0].items[1].item).toEqual({ type: "agentMessage", text: "On it" });
    expect(useAgentTurnsStore.getState().threadByChat["chat-1"]).toBe("thread-1");
  });

  it("keeps records immutable per publish so React sees new references", () => {
    const store = useAgentTurnsStore.getState();
    store.beginTurn("chat-1", "thread-1", "c1", "hello");
    const first = useAgentTurnsStore.getState().recordsByChat["chat-1"][0];
    store.applyEvent("chat-1", { kind: "textDelta", text: "reply" });
    const second = useAgentTurnsStore.getState().recordsByChat["chat-1"][0];
    expect(second).not.toBe(first);
    // The earlier snapshot is not mutated by later deltas.
    expect(first.items[1]).toBeUndefined();
    expect(second.items[1]?.item).toEqual({ type: "agentMessage", text: "reply" });
  });

  it("queues follow-ups, marks them steered, and takes them once", () => {
    const store = useAgentTurnsStore.getState();
    store.queueFollowUp("chat-1", "then check the figures");
    store.queueFollowUp("chat-1", "   ");
    expect(useAgentTurnsStore.getState().queuedByChat["chat-1"]).toHaveLength(1);

    const queued = useAgentTurnsStore.getState().queuedByChat["chat-1"][0];
    store.markSteered("chat-1", queued.id);
    expect(useAgentTurnsStore.getState().queuedByChat["chat-1"][0].status).toBe("steered");

    const taken = useAgentTurnsStore.getState().takeFollowUps("chat-1");
    expect(taken).toHaveLength(1);
    expect(taken[0].status).toBe("steered");
    expect(useAgentTurnsStore.getState().queuedByChat["chat-1"]).toBeUndefined();
  });

  it("reuses a thread per chat and claims prewarmed threads once", async () => {
    const claim = vi.fn().mockResolvedValue("prewarmed-thread");
    const store = useAgentTurnsStore.getState();
    const first = await store.threadFor("chat-1", "proj", claim);
    expect(first).toBe("prewarmed-thread");
    expect(claim).toHaveBeenCalledTimes(1);
    // Second call reuses without claiming again.
    const second = await useAgentTurnsStore.getState().threadFor("chat-1", "proj", claim);
    expect(second).toBe("prewarmed-thread");
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("falls back to a fresh thread when no prewarm is warm", async () => {
    const store = useAgentTurnsStore.getState();
    const thread = await store.threadFor("chat-2", "proj", () => Promise.resolve(null));
    expect(thread).toMatch(/^thread-/);
  });

  it("marks interrupted turns and clears the fold", () => {
    const store = useAgentTurnsStore.getState();
    store.beginTurn("chat-1", "thread-1", "c1", "hello");
    store.applyEvent("chat-1", { kind: "textDelta", text: "partial" });
    useAgentTurnsStore.getState().interruptTurn("chat-1");
    expect(useAgentTurnsStore.getState().recordsByChat["chat-1"][0].status).toBe("interrupted");
    // Late events after an interrupt are dropped.
    useAgentTurnsStore.getState().applyEvent("chat-1", { kind: "textDelta", text: "late" });
    expect(useAgentTurnsStore.getState().recordsByChat["chat-1"][0].items).toHaveLength(2);
  });
});
