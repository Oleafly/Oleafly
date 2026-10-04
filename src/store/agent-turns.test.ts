import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentTurnsStore } from "./agent-turns";

describe("useAgentTurnsStore", () => {
  beforeEach(() => {
    useAgentTurnsStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
    vi.useFakeTimers();
    const store = useAgentTurnsStore.getState();
    store.beginTurn("chat-1", "thread-1", "c1", "hello");
    const first = useAgentTurnsStore.getState().recordsByChat["chat-1"][0];
    store.applyEvent("chat-1", { kind: "textDelta", text: "reply" });
    vi.advanceTimersByTime(20);
    const second = useAgentTurnsStore.getState().recordsByChat["chat-1"][0];
    expect(second).not.toBe(first);
    // The earlier snapshot is not mutated by later deltas.
    expect(first.items[1]).toBeUndefined();
    expect(second.items[1]?.item).toEqual({ type: "agentMessage", text: "reply" });
  });

  it("keeps a selected follow-up queued until its send is acknowledged", () => {
    const store = useAgentTurnsStore.getState();
    store.queueFollowUp("chat-1", "then check the figures", [
      {
        id: "figures.pdf-4-1",
        name: "figures.pdf",
        mediaType: "application/pdf",
        dataUrl: "data:application/pdf;base64,UEZERg==",
      },
    ]);
    store.queueFollowUp("chat-1", "then check the tables");

    const selected = store.takeFollowUps("chat-1");
    expect(selected.map((item) => item.text)).toEqual(["then check the figures"]);
    expect(selected[0].attachments).toEqual([
      {
        id: "figures.pdf-4-1",
        name: "figures.pdf",
        mediaType: "application/pdf",
        dataUrl: "data:application/pdf;base64,UEZERg==",
      },
    ]);
    expect(useAgentTurnsStore.getState().queuedByChat["chat-1"]?.map((item) => item.text)).toEqual([
      "then check the figures",
      "then check the tables",
    ]);

    store.acknowledgeFollowUp("chat-1", selected[0].id);
    expect(useAgentTurnsStore.getState().queuedByChat["chat-1"]?.map((item) => item.text)).toEqual([
      "then check the tables",
    ]);
  });

  it("marks a follow-up by its owning run when another chat is viewed", () => {
    const store = useAgentTurnsStore.getState();
    store.queueFollowUp("run-chat", "steer this run");
    const queued = useAgentTurnsStore.getState().queuedByChat["run-chat"][0];

    store.markSteered("viewed-chat", queued.id);
    expect(useAgentTurnsStore.getState().queuedByChat["run-chat"][0].status).toBe("steered");
  });

  it("removes only the targeted queued follow-up", () => {
    const store = useAgentTurnsStore.getState();
    store.queueFollowUp("chat-1", "keep this one");
    store.queueFollowUp("chat-1", "discard this one");
    store.queueFollowUp("chat-2", "keep the other chat");
    const discarded = useAgentTurnsStore.getState().queuedByChat["chat-1"][1];

    store.removeFollowUp("chat-1", discarded.id);

    expect(useAgentTurnsStore.getState().queuedByChat["chat-1"].map((item) => item.text)).toEqual([
      "keep this one",
    ]);
    expect(useAgentTurnsStore.getState().queuedByChat["chat-2"].map((item) => item.text)).toEqual([
      "keep the other chat",
    ]);
  });

  it("drops delivered steers and keeps queued messages when a run ends badly", () => {
    const store = useAgentTurnsStore.getState();
    store.queueFollowUp("chat-1", "already delivered");
    store.queueFollowUp("chat-1", "still waiting its turn");
    const delivered = useAgentTurnsStore.getState().queuedByChat["chat-1"][0];
    store.markSteered("chat-1", delivered.id);

    store.purgeSteeredFollowUps("chat-1");

    expect(useAgentTurnsStore.getState().queuedByChat["chat-1"].map((item) => item.text)).toEqual([
      "still waiting its turn",
    ]);
  });

  it("clears a chat queue whose only follow-ups were steered", () => {
    const store = useAgentTurnsStore.getState();
    store.queueFollowUp("chat-1", "delivered mid-run");
    store.queueFollowUp("chat-2", "another chat waits");
    const delivered = useAgentTurnsStore.getState().queuedByChat["chat-1"][0];
    store.markSteered("chat-1", delivered.id);

    store.purgeSteeredFollowUps("chat-1");

    expect(useAgentTurnsStore.getState().queuedByChat).not.toHaveProperty("chat-1");
    expect(useAgentTurnsStore.getState().queuedByChat["chat-2"]).toHaveLength(1);
  });

  it("cleans up a chat queue after removing its final follow-up", () => {
    const store = useAgentTurnsStore.getState();
    store.queueFollowUp("chat-1", "discard the final message");
    store.queueFollowUp("chat-2", "keep the other chat");
    const discarded = useAgentTurnsStore.getState().queuedByChat["chat-1"][0];

    store.removeFollowUp("chat-1", discarded.id);

    expect(useAgentTurnsStore.getState().queuedByChat).not.toHaveProperty("chat-1");
    expect(useAgentTurnsStore.getState().queuedByChat["chat-2"]).toHaveLength(1);
  });

  it("publishes a burst of text deltas at most once per frame", () => {
    vi.useFakeTimers();
    const clone = vi.spyOn(globalThis, "structuredClone");
    const store = useAgentTurnsStore.getState();
    store.beginTurn("chat-1", "thread-1", "c1", "hello");
    const first = useAgentTurnsStore.getState().recordsByChat["chat-1"][0];
    const userItem = first.items[0];
    const before = clone.mock.calls.length;

    for (let index = 0; index < 100; index += 1) {
      store.applyEvent("chat-1", { kind: "textDelta", text: "x" });
    }

    expect(clone.mock.calls.length - before).toBe(0);
    vi.advanceTimersByTime(20);
    expect(clone.mock.calls.length - before).toBe(0);
    const record = useAgentTurnsStore.getState().recordsByChat["chat-1"][0];
    expect(record).not.toBe(first);
    expect(record.items[0]).toBe(userItem);
    expect(record.items[1].item).toEqual({ type: "agentMessage", text: "x".repeat(100) });
  });

  it("publishes only newly appended items for event consumers", () => {
    const store = useAgentTurnsStore.getState();
    store.beginTurn("chat-1", "thread-1", "c1", "hello");
    store.applyEvent("chat-1", {
      kind: "toolCallStart",
      id: "tool-1",
      name: "computer_use",
    });

    const added = useAgentTurnsStore.getState().addedItemsByChat["chat-1"];
    expect(added).toHaveLength(1);
    expect(added[0].item).toMatchObject({
      type: "dynamicToolCall",
      tool: "computer_use",
      status: "inProgress",
    });
  });

  it("publishes an out-of-order tool outcome without cloning the completed prefix", () => {
    const store = useAgentTurnsStore.getState();
    store.beginTurn("chat-1", "thread-1", "c1", "hello");
    store.applyEvent("chat-1", { kind: "toolCallStart", id: "call-1", name: "read_file" });
    store.applyEvent("chat-1", { kind: "toolCallStart", id: "call-2", name: "run_command" });
    const before = useAgentTurnsStore.getState().recordsByChat["chat-1"][0];

    store.applyEvent("chat-1", { kind: "toolOutcome", id: "call-1", output: "contents" });
    const afterFirst = useAgentTurnsStore.getState().recordsByChat["chat-1"][0];

    expect(afterFirst.items[0]).toBe(before.items[0]);
    expect(afterFirst.items[1]).not.toBe(before.items[1]);
    expect(afterFirst.items[1].item).toMatchObject({
      type: "dynamicToolCall",
      output: "contents",
      status: "completed",
    });
    expect(before.items[1].item).toMatchObject({
      type: "dynamicToolCall",
      output: null,
      status: "inProgress",
    });

    store.applyEvent("chat-1", {
      kind: "toolOutcome",
      id: "call-2",
      output: '{"exec":true,"exit_code":7}',
    });
    const afterSecond = useAgentTurnsStore.getState().recordsByChat["chat-1"][0];

    expect(afterSecond.items[0]).toBe(afterFirst.items[0]);
    expect(afterSecond.items[1]).toBe(afterFirst.items[1]);
    expect(afterFirst.items[2].item).toMatchObject({
      type: "commandExecution",
      exitCode: null,
      status: "inProgress",
    });
    expect(afterSecond.items[2].item).toMatchObject({
      type: "commandExecution",
      exitCode: 7,
      status: "failed",
    });
  });

  it("reuses earlier streaming items while a later message receives deltas", () => {
    vi.useFakeTimers();
    const store = useAgentTurnsStore.getState();
    store.beginTurn("chat-1", "thread-1", "c1", "hello");
    store.applyEvent("chat-1", { kind: "textDelta", text: "early text" });
    vi.advanceTimersByTime(20);
    store.applyEvent("chat-1", { kind: "reasoningDelta", text: "early reasoning" });
    vi.advanceTimersByTime(20);
    store.applyEvent("chat-1", { kind: "toolCallStart", id: "call-1", name: "read_file" });
    store.applyEvent("chat-1", { kind: "toolOutcome", id: "call-1", output: "contents" });
    store.applyEvent("chat-1", { kind: "textDelta", text: "later" });
    vi.advanceTimersByTime(20);

    const before = useAgentTurnsStore.getState().recordsByChat["chat-1"][0];
    store.applyEvent("chat-1", { kind: "textDelta", text: " message" });
    vi.advanceTimersByTime(20);
    const after = useAgentTurnsStore.getState().recordsByChat["chat-1"][0];

    expect(after.items[0]).toBe(before.items[0]);
    expect(after.items[1]).toBe(before.items[1]);
    expect(after.items[2]).toBe(before.items[2]);
    expect(after.items[3]).toBe(before.items[3]);
    expect(after.items[4]).not.toBe(before.items[4]);
    expect(after.items[4].item).toEqual({ type: "agentMessage", text: "later message" });
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

  it("adopts a persisted thread instead of forking after a restart", async () => {
    const claim = vi.fn().mockResolvedValue("prewarmed-thread");
    const persist = vi.fn();
    const store = useAgentTurnsStore.getState();
    const thread = await store.threadFor("chat-restart", "proj", claim, {
      persistedThreadId: "thread-from-disk",
      persist,
    });
    expect(thread).toBe("thread-from-disk");
    // The persisted thread wins: no prewarm claim, no re-persist.
    expect(claim).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("persists a freshly minted thread so a later reopen can adopt it", async () => {
    const persist = vi.fn();
    const store = useAgentTurnsStore.getState();
    const thread = await store.threadFor(
      "chat-fresh",
      "proj",
      () => Promise.resolve(null),
      { persistedThreadId: null, persist },
    );
    expect(thread).toMatch(/^thread-/);
    expect(persist).toHaveBeenCalledWith(thread);
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

  it("rolls back a turn the request never started and keeps earlier turns", () => {
    const store = useAgentTurnsStore.getState();
    store.beginTurn("chat-1", "thread-1", "c1", "first");
    store.finishTurn("chat-1", false);
    store.beginTurn("chat-1", "thread-1", "c2", "second");

    useAgentTurnsStore.getState().rollbackTurn("chat-1", "c2");

    const state = useAgentTurnsStore.getState();
    expect(state.recordsByChat["chat-1"].map((record) => record.clientTurnId)).toEqual(["c1"]);
    expect(state.addedItemsByChat["chat-1"]).toBeUndefined();
    useAgentTurnsStore.getState().applyEvent("chat-1", { kind: "textDelta", text: "late" });
    expect(useAgentTurnsStore.getState().recordsByChat["chat-1"]).toHaveLength(1);
  });

  it("forgets a chat's records when its only turn is rolled back, and ignores unknown turns", () => {
    const store = useAgentTurnsStore.getState();
    store.beginTurn("chat-1", "thread-1", "c1", "only");

    useAgentTurnsStore.getState().rollbackTurn("chat-1", "missing");
    expect(useAgentTurnsStore.getState().recordsByChat["chat-1"]).toHaveLength(1);

    useAgentTurnsStore.getState().rollbackTurn("chat-1", "c1");
    expect(useAgentTurnsStore.getState().recordsByChat).not.toHaveProperty("chat-1");

    useAgentTurnsStore.getState().rollbackTurn("chat-2", "c9");
    expect(useAgentTurnsStore.getState().recordsByChat).toEqual({});
  });

  it("ignores events and endings for a chat without a running turn", () => {
    const store = useAgentTurnsStore.getState();

    store.applyEvent("idle", { kind: "textDelta", text: "stray" });
    store.finishTurn("idle", false);
    store.interruptTurn("idle");

    expect(useAgentTurnsStore.getState().recordsByChat).toEqual({});
  });

  it("does not queue an empty follow-up but queues an attachment on its own", () => {
    const store = useAgentTurnsStore.getState();

    store.queueFollowUp("chat-1", "   ");
    expect(useAgentTurnsStore.getState().queuedByChat).toEqual({});

    store.queueFollowUp("chat-1", "  ", [{ id: "a1", name: "fig.png", mediaType: "image/png", dataUrl: "data:image/png;base64,AAAA" }]);
    expect(useAgentTurnsStore.getState().queuedByChat["chat-1"]).toEqual([
      expect.objectContaining({ text: "", status: "pending", attachments: [expect.objectContaining({ name: "fig.png" })] }),
    ]);
  });

  it("ignores steering, removal and acknowledgement of unknown follow-ups", () => {
    const store = useAgentTurnsStore.getState();
    store.queueFollowUp("chat-1", "next");
    const before = useAgentTurnsStore.getState().queuedByChat;

    store.markSteered("chat-1", "missing");
    store.removeFollowUp("chat-1", "missing");
    store.removeFollowUp("chat-2", "missing");
    store.acknowledgeFollowUp("chat-1", "missing");
    store.acknowledgeFollowUp("chat-2", "missing");

    expect(useAgentTurnsStore.getState().queuedByChat).toBe(before);
    expect(store.takeFollowUps("chat-2")).toEqual([]);
  });

  it("keeps the remaining follow-ups after one is acknowledged", () => {
    const store = useAgentTurnsStore.getState();
    store.queueFollowUp("chat-1", "first");
    store.queueFollowUp("chat-1", "second");
    const [first] = useAgentTurnsStore.getState().queuedByChat["chat-1"];

    store.acknowledgeFollowUp("chat-1", first.id);

    expect(useAgentTurnsStore.getState().queuedByChat["chat-1"].map((item) => item.text)).toEqual(["second"]);
  });

  it("mints a thread without asking for a prewarmed one when no project is open", async () => {
    const claim = vi.fn(async () => "prewarmed");

    const thread = await useAgentTurnsStore.getState().threadFor("chat-9", null, claim);

    expect(claim).not.toHaveBeenCalled();
    expect(thread).toMatch(/^thread-/);
  });

  it("mints a thread when claiming a prewarmed one fails", async () => {
    const thread = await useAgentTurnsStore
      .getState()
      .threadFor("chat-8", "project", () => Promise.reject(new Error("pool empty")));

    expect(thread).toMatch(/^thread-/);
  });
});

