import { describe, expect, it, vi } from "vitest";
import { cancelChatRun, ChatRunIsolation } from "./chat-run-lifecycle";

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
