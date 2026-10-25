import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/store/chats";
import {
  changedFileCount,
  lastTurnStart,
  messageActionState,
  replayMode,
  turnStartIndex,
  turnsToDrop,
  userTurnsFrom,
} from "./chat-replay";

const user = (id: string, content = id, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: "user",
  content,
  ...extra,
});
const reply = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: "assistant",
  content: `reply ${id}`,
  ...extra,
});

const files = (count: number, more = 0) => ({
  snapshotId: null,
  files: Array.from({ length: count }, (_, index) => ({ path: `f${index}.tex` })) as never[],
  moreFiles: more,
  skipped: [],
  overlapped: false,
  unavailable: null,
});

describe("chat replay", () => {
  it("finds the user message that started a turn, past steered messages", () => {
    const messages = [user("u1"), reply("a1"), user("u2"), user("s", "steer", { steered: true }), reply("a2")];
    expect(turnStartIndex(messages, 4)).toBe(2);
    expect(lastTurnStart(messages)).toBe(2);
    expect(turnStartIndex([reply("x")], 0)).toBe(-1);
    expect(userTurnsFrom(messages, 0)).toBe(2);
  });

  it("counts files changed from a message onwards", () => {
    const messages = [user("u1"), reply("a1", { turnChanges: files(1) }), user("u2"), reply("a2", { turnChanges: files(2, 3) })];
    expect(changedFileCount(messages, 0)).toBe(6);
    expect(changedFileCount(messages, 2)).toBe(5);
  });

  it("drops turns from the matching client turn id, or falls back", () => {
    expect(turnsToDrop(["t1", "t2", "t3"], "t2", 9)).toBe(2);
    expect(turnsToDrop(["t1", null], "missing", 1)).toBe(1);
    expect(turnsToDrop([], undefined, 0)).toBe(0);
  });

  it("edits the last turn in place and earlier turns by forking", () => {
    const messages = [user("u1"), reply("a1"), user("u2"), reply("a2")];
    expect(replayMode(messages, 2)).toBe("inPlace");
    expect(replayMode(messages, 0)).toBe("fork");
  });

  it("offers Regenerate on the latest reply and Retry when it failed", () => {
    const messages = [user("u1"), reply("a1"), user("u2"), reply("a2")];
    expect(messageActionState(messages, 3, { enabled: true })).toEqual({ regenerate: "regenerate" });
    expect(messageActionState(messages, 1, { enabled: true })).toEqual({});
    const failed = [user("u1"), reply("a1", { failed: true })];
    expect(messageActionState(failed, 1, { enabled: true })).toEqual({ regenerate: "retry" });
  });

  it("offers Edit on the user's own messages but not on steered ones or the plan approval", () => {
    const messages = [user("u1"), user("s", "steer", { steered: true }), user("p", "Approve the plan"), user("", "no id")];
    expect(messageActionState(messages, 0, { enabled: true })).toEqual({ editable: true });
    expect(messageActionState(messages, 1, { enabled: true })).toEqual({});
    expect(messageActionState(messages, 2, { enabled: true, excludeContent: "Approve the plan" })).toEqual({});
    expect(messageActionState(messages, 3, { enabled: true })).toEqual({});
  });

  it("offers nothing while disabled", () => {
    expect(messageActionState([user("u1"), reply("a1")], 1, { enabled: false })).toEqual({});
  });
});
