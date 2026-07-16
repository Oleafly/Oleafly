import { describe, expect, it, vi } from "vitest";
import {
  cancelChatRun,
  ChatRunIsolation,
  scheduleChatPersistence,
} from "./chat-run-lifecycle";

describe("cancelChatRun", () => {
  it("aborts the provider request and cancels pending persistence", () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const persist = vi.fn();
    const discardQueuedPatches = vi.fn();
    const timer = setTimeout(persist, 400);

    cancelChatRun(controller, timer, discardQueuedPatches);
    vi.advanceTimersByTime(400);

    expect(controller.signal.aborted).toBe(true);
    expect(persist).not.toHaveBeenCalled();
    expect(discardQueuedPatches).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

describe("ChatRunIsolation", () => {
  it("prevents a cancelled project-A run from mutating project B", () => {
    const isolation = new ChatRunIsolation();
    const runA = isolation.begin("project-a");
    const chats = new Map([["chat-a", ["started"]], ["chat-b", ["existing-b"]]]);
    const mutateA = (message: string, currentProject: string) => {
      if (!isolation.allows(runA, currentProject)) return;
      chats.set("chat-a", [...(chats.get("chat-a") ?? []), message]);
    };

    mutateA("stream part", "project-a");
    isolation.invalidate();
    mutateA("late catch/finally", "project-b");

    expect(chats.get("chat-a")).toEqual(["started", "stream part"]);
    expect(chats.get("chat-b")).toEqual(["existing-b"]);
  });
});

describe("scheduleChatPersistence", () => {
  it("saves to the chat captured when the snapshot was scheduled", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    let activeChat = "chat-a";

    scheduleChatPersistence(null, activeChat, ["reply-a"], save);
    activeChat = "chat-b";
    vi.advanceTimersByTime(400);

    expect(save).toHaveBeenCalledWith("chat-a", ["reply-a"]);
    expect(save).not.toHaveBeenCalledWith("chat-b", expect.anything());
    vi.useRealTimers();
  });

  it("cancels the superseded snapshot", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const first = scheduleChatPersistence(null, "chat-a", ["old"], save);

    scheduleChatPersistence(first, "chat-a", ["new"], save);
    vi.advanceTimersByTime(400);

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith("chat-a", ["new"]);
    vi.useRealTimers();
  });
});
