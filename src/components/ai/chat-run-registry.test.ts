import { describe, expect, it, vi } from "vitest";
import {
  activeChatRun,
  activeChatRuns,
  beginChatRun,
  endChatRun,
  projectHasChatRun,
  subscribeChatRun,
  updateChatRun,
  WORKSPACE_ASSISTANT_SCOPE,
} from "./chat-run-registry";

describe("the chat run registry", () => {
  it("keeps one run per scope so a note run and a workspace run never replace each other", () => {
    const workspace = beginChatRun(new AbortController(), "paper");
    const note = beginChatRun(new AbortController(), "note-1", "note:note-1");
    expect(workspace.scope).toBe(WORKSPACE_ASSISTANT_SCOPE);
    expect(activeChatRun()).toBe(workspace);
    expect(activeChatRun("note:note-1")).toBe(note);
    expect(activeChatRuns()).toEqual([workspace, note]);
    expect(projectHasChatRun("paper")).toBe(true);
    expect(projectHasChatRun("note-1")).toBe(true);
    expect(projectHasChatRun("elsewhere")).toBe(false);

    endChatRun(note);
    expect(activeChatRun("note:note-1")).toBeNull();
    expect(activeChatRun()).toBe(workspace);
    endChatRun(workspace);
    expect(activeChatRuns()).toEqual([]);
  });

  it("updates and ends only the run that still owns its scope", () => {
    const listener = vi.fn();
    const stop = subscribeChatRun(listener);
    const first = beginChatRun(new AbortController(), "note-1", "note:a");
    const second = beginChatRun(new AbortController(), "note-1", "note:a");
    listener.mockClear();
    updateChatRun(first, { chatId: "stale" });
    endChatRun(first);
    expect(first.chatId).toBeNull();
    expect(activeChatRun("note:a")).toBe(second);
    expect(listener).not.toHaveBeenCalled();
    updateChatRun(second, { chatId: "chat-1", lastPartAt: 5 });
    expect(second).toMatchObject({ chatId: "chat-1", lastPartAt: 5 });
    expect(listener).toHaveBeenCalledOnce();
    stop();
    endChatRun(second);
    expect(listener).toHaveBeenCalledOnce();
  });
});
