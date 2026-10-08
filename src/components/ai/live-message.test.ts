import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/store/chats";
import {
  createLiveMessageStore,
  differsOnlyInStream,
  differsOnlyInText,
  liveMessageFor,
  streamedEntryChange,
  textOnlyChange,
} from "./live-message";

const user: ChatMessage = { id: "u", role: "user", content: "Question" };
const reply: ChatMessage = { id: "a", role: "assistant", content: "" };

describe("live message store", () => {
  it("notifies subscribers once per change and stops after unsubscribe", () => {
    const store = createLiveMessageStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const live = { base: reply, message: { ...reply, content: "Hel" } };

    store.set(live);
    store.set(live);
    store.set(null);
    store.set(null);
    unsubscribe();
    store.set(live);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.get()).toBe(live);
  });

  it("shows the streamed message only in place of the message the stream started from", () => {
    const streamed = { ...reply, content: "Hello" };
    const live = { base: reply, message: streamed };

    expect(liveMessageFor(reply, live)).toBe(streamed);
    expect(liveMessageFor(user, live)).toBe(user);
    expect(liveMessageFor(streamed, live)).toBe(streamed);
    expect(liveMessageFor(reply, null)).toBe(reply);
  });

  it("treats streamed reply and reasoning text as a text change", () => {
    const thinking: ChatMessage = {
      ...reply,
      reasoningBlocks: [{ id: "r1", text: "Let me", beforeTool: 0 }],
    };

    expect(differsOnlyInText(reply, { ...reply, content: "Hi" })).toBe(true);
    expect(
      differsOnlyInText(thinking, {
        ...thinking,
        reasoningBlocks: [{ id: "r1", text: "Let me check", beforeTool: 0 }],
      }),
    ).toBe(true);
    expect(differsOnlyInText(reply, reply)).toBe(false);
    expect(
      differsOnlyInText(thinking, {
        ...thinking,
        reasoningBlocks: [{ id: "r1", text: "Let me", ms: 900, beforeTool: 0 }],
      }),
    ).toBe(false);
    expect(differsOnlyInText(thinking, { ...thinking, reasoningBlocks: [] })).toBe(false);
    expect(
      differsOnlyInText(reply, {
        ...reply,
        toolCalls: [{ id: "t1", name: "read_file", status: "running" }],
      }),
    ).toBe(false);
    expect(differsOnlyInText(reply, { ...reply, createdAt: 5 })).toBe(false);
  });

  it("finds a text-only change to the newest message of the same conversation", () => {
    const committed = [user, reply];
    const streamed = { ...reply, content: "Hello" };

    expect(textOnlyChange(committed, [user, streamed])).toEqual({ base: reply, message: streamed });
    expect(textOnlyChange(committed, [{ ...user }, streamed])).toBeNull();
    expect(textOnlyChange(committed, [user, streamed, reply])).toBeNull();
    expect(textOnlyChange(committed, [user, { ...streamed, createdAt: 9 }])).toBeNull();
    expect(textOnlyChange([], [])).toBeNull();
  });

  it("treats tool output and status on the same tools as a streamed change", () => {
    const running: ChatMessage = {
      ...reply,
      toolCalls: [{ id: "t1", name: "Run latexmk", status: "running", output: "pass 1" }],
    };

    expect(
      differsOnlyInStream(running, {
        ...running,
        toolCalls: [{ id: "t1", name: "Run latexmk", status: "done", output: "pass 1\npass 2" }],
      }),
    ).toBe(true);
    expect(differsOnlyInStream(running, { ...running, content: "Done", notices: ["Retried once"] })).toBe(true);
    expect(differsOnlyInStream(running, running)).toBe(false);
    expect(
      differsOnlyInStream(running, {
        ...running,
        toolCalls: [{ id: "t2", name: "Run latexmk", status: "running" }],
      }),
    ).toBe(false);
    expect(
      differsOnlyInStream(running, {
        ...running,
        toolCalls: [...(running.toolCalls ?? []), { id: "t2", name: "Read", status: "running" }],
      }),
    ).toBe(false);
    expect(
      differsOnlyInStream(running, {
        ...running,
        turnChanges: { snapshotId: null, files: [], moreFiles: 0, skipped: [], overlapped: false, unavailable: "error" },
      }),
    ).toBe(false);
    expect(differsOnlyInStream(running, { ...running, role: "user" })).toBe(false);
  });

  it("finds a streamed change to any one row whose place in the list stays the same", () => {
    const entry = (msg: ChatMessage, index: number, live = false) => ({
      key: msg.id ?? String(index),
      index,
      live,
      isLatestAssistant: false,
      msg,
    });
    const tool: ChatMessage = {
      id: "tool",
      role: "assistant",
      content: "",
      toolCalls: [{ id: "t1", name: "Run latexmk", status: "running", output: "pass 1" }],
    };
    const committed = [entry(user, 0), entry(tool, 1), entry(reply, 2, true)];
    const toolOutput = { ...tool, toolCalls: [{ id: "t1", name: "Run latexmk", status: "running" as const, output: "pass 1\npass 2" }] };
    const next = [committed[0], entry(toolOutput, 1), committed[2]];

    expect(streamedEntryChange(committed, next)).toEqual({ base: tool, message: toolOutput });
    expect(streamedEntryChange(committed, committed)).toBeNull();
    expect(streamedEntryChange(committed, [committed[0], next[1], entry({ ...reply, content: "Hi" }, 2, true)])).toBeNull();
    expect(streamedEntryChange(committed, [...next, entry({ ...reply, id: "b" }, 3)])).toBeNull();
    expect(streamedEntryChange(committed, [committed[0], committed[1], entry({ ...reply, content: "Hi" }, 2, false)])).toBeNull();
    expect(streamedEntryChange(committed, [committed[0], { ...next[1], key: "other" }, committed[2]])).toBeNull();
    expect(
      streamedEntryChange(committed, [committed[0], committed[1], { ...committed[2], msg: { ...reply, createdAt: 4 } }]),
    ).toBeNull();
  });
});
