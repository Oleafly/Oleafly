import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => new Map<string, string>());
const chatSave = vi.hoisted(() => vi.fn(async (_projectId: string, _chatId: string, _json: string) => {}));
const chatRead = vi.hoisted(() => vi.fn(async (_projectId: string, _chatId: string) => ""));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock("@/lib/tauri", () => ({
  chatsLoad: vi.fn(async (pid: string) => ({ json: disk.get(pid) ?? "[]", skipped: pid === "note-1" ? 2 : 0 })),
  chatSave,
  chatRead,
  chatDelete: vi.fn(async () => {}),
}));
vi.mock("@/lib/attachments", () => ({ attachmentGc: vi.fn(async () => 0) }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/agent-backend", () => ({ agentThreadDelete: vi.fn(async () => {}) }));

import { shownChats, useChatsStore, WORKSPACE_CHAT_SCOPE, type StoredChat } from "./chats";

const NOTE = "note:note-1";

function stored(projectId: string, id: string, extra: Partial<StoredChat> = {}): StoredChat {
  return { id, projectId, title: id, createdAt: 1, updatedAt: 1, messages: [], headOid: null, ...extra };
}

beforeEach(() => {
  disk.clear();
  chatSave.mockClear();
  chatRead.mockReset();
  useChatsStore.setState({ projectId: null, chats: [], activeId: null, skippedOnLoad: 0, shownByScope: {}, live: {} });
});

describe("chats shown per scope", () => {
  it("keeps the workspace and a note showing their own project and chat", async () => {
    disk.set("paper", JSON.stringify([stored("paper", "paper-chat")]));
    disk.set("note-1", JSON.stringify([stored("note-1", "note-chat")]));
    const store = useChatsStore.getState();
    await store.load("paper");
    await store.load("note-1", NOTE);
    store.setActive("paper-chat");
    store.setActive("note-chat", NOTE);

    const state = useChatsStore.getState();
    expect(shownChats(state)).toMatchObject({ projectId: "paper", activeId: "paper-chat", skippedOnLoad: 0 });
    expect(shownChats(state, WORKSPACE_CHAT_SCOPE).chats.map((chat) => chat.id)).toEqual(["paper-chat"]);
    expect(shownChats(state, NOTE)).toMatchObject({ projectId: "note-1", activeId: "note-chat", skippedOnLoad: 2 });
    expect(state.byId("note-chat", NOTE)?.projectId).toBe("note-1");
    expect(state.byId("note-chat")).toBeUndefined();
    expect(shownChats(state, "note:unknown")).toEqual({ projectId: null, chats: [], activeId: null, skippedOnLoad: 0 });
  });

  it("creates, saves, titles and costs a note chat without touching the workspace", () => {
    useChatsStore.setState({ projectId: "paper", chats: [stored("paper", "paper-chat")], activeId: "paper-chat" });
    const store = useChatsStore.getState();
    const chat = store.create("note-1", null, { effort: "high", web: { search: true, fetch: false } }, NOTE);
    store.saveMessages(chat.id, [{ role: "user", content: "Plan the ablation study" }], { scope: NOTE });
    store.addUsage(chat.id, { inputTokens: 5, outputTokens: 2, steps: 1 }, NOTE);
    store.setChatCost(chat.id, 0.25, NOTE);
    store.setChatSettings(chat.id, { effort: null, web: null }, NOTE);
    store.setThreadId(chat.id, "thread-1", NOTE);
    store.patchTitleIfEmpty(chat.id, "ignored", NOTE);

    const state = useChatsStore.getState();
    expect(state.activeId).toBe("paper-chat");
    expect(state.chats.map((entry) => entry.id)).toEqual(["paper-chat"]);
    const saved = state.byId(chat.id, NOTE);
    expect(saved).toMatchObject({ title: "Plan the ablation study", threadId: "thread-1" });
    expect(saved?.usage).toMatchObject({ inputTokens: 5, outputTokens: 2, estimatedUsd: 0.25 });
    expect(saved).not.toHaveProperty("effort");
    expect(saved).not.toHaveProperty("web");
    expect(shownChats(state, NOTE).activeId).toBe(chat.id);
    expect(chatSave).toHaveBeenCalledWith("note-1", chat.id, expect.any(String), true);
  });

  it("does nothing for scoped calls before the scope shows a project", () => {
    const store = useChatsStore.getState();
    store.patchTitleIfEmpty("missing", "x", NOTE);
    store.addUsage("missing", { inputTokens: 1, outputTokens: 1, steps: 1 }, NOTE);
    store.setChatSettings("missing", { effort: "low" }, NOTE);
    store.setChatCost("missing", 1, NOTE);
    store.setThreadId("missing", "t", NOTE);
    store.saveMessages("missing", [], { scope: NOTE });
    store.remove("missing", { scope: NOTE });
    expect(chatSave).not.toHaveBeenCalled();
    return expect(store.loadChatBody("missing", NOTE)).resolves.toBeNull();
  });

  it("removes a note chat only from its scope and keeps the workspace live reply", async () => {
    disk.set("note-rm", JSON.stringify([stored("note-rm", "a"), stored("note-rm", "b")]));
    useChatsStore.setState({ projectId: "paper", chats: [stored("paper", "paper-chat")], activeId: "paper-chat" });
    const store = useChatsStore.getState();
    await store.load("note-rm", NOTE);
    store.setActive("a", NOTE);
    store.setLive("paper-chat", [{ role: "assistant", content: "streaming" }]);
    store.remove("a", { scope: NOTE });

    const state = useChatsStore.getState();
    expect(shownChats(state, NOTE).chats.map((chat) => chat.id)).toEqual(["b"]);
    expect(shownChats(state, NOTE).activeId).toBeNull();
    expect(state.activeId).toBe("paper-chat");
    expect(state.liveOrSaved("paper-chat")).toEqual([{ role: "assistant", content: "streaming" }]);
  });

  it("keeps a project note's chats apart from the project's chats in the same folder", async () => {
    const plan = "note:project-note:paper:notes/Plan.md";
    const owner = "paper#plan";
    disk.set("paper", JSON.stringify([stored("paper", "paper-chat"), stored("paper", "plan-chat", { scope: owner })]));
    const store = useChatsStore.getState();
    await store.load("paper");
    await store.load("paper", plan, owner);
    store.setActive("paper-chat");
    const ids = (scope?: string) => shownChats(useChatsStore.getState(), scope).chats.map((chat) => chat.id);
    expect(ids()).toEqual(["paper-chat"]);
    expect(ids(plan)).toEqual(["plan-chat"]);

    const created = store.create("paper", null, undefined, plan);
    expect(created.scope).toBe(owner);
    expect(ids()).toEqual(["paper-chat"]);
    expect(ids(plan)).toEqual([created.id, "plan-chat"]);

    store.remove("paper-chat", { scope: plan });
    store.saveMessages("paper-chat", [{ role: "user", content: "still saved" }]);
    expect(useChatsStore.getState().byId("paper-chat")?.messages).toHaveLength(1);
    expect(chatSave).toHaveBeenCalledWith("paper", "paper-chat", expect.stringContaining("still saved"), true);
  });

  it("keeps a note run's live reply when the workspace switches project", async () => {
    disk.set("note-live", JSON.stringify([stored("note-live", "note-chat")]));
    const store = useChatsStore.getState();
    await store.load("note-live", NOTE);
    store.setLive("note-chat", [{ role: "assistant", content: "note reply" }]);
    store.setLive("stale-chat", [{ role: "assistant", content: "old" }]);
    await store.load("other-paper");

    const live = useChatsStore.getState().live;
    expect(live["note-chat"]).toBeDefined();
    expect(live["stale-chat"]).toBeUndefined();
    expect(useChatsStore.getState().liveOrSaved("note-chat", NOTE)?.[0].content).toBe("note reply");
  });

  it("shares saved changes with every scope showing the same project", async () => {
    disk.set("note-shared", JSON.stringify([stored("note-shared", "shared")]));
    const store = useChatsStore.getState();
    await store.load("note-shared", NOTE);
    await store.load("note-shared", "note:other-view");
    store.saveMessages("shared", [{ role: "user", content: "hello" }], { scope: NOTE });
    const state = useChatsStore.getState();
    expect(state.byId("shared", "note:other-view")?.messages).toHaveLength(1);
  });

  it("reads a stub chat body into its scope", async () => {
    disk.set("note-stub", JSON.stringify([stored("note-stub", "stub", { stub: true, messageCount: 1 })]));
    chatRead.mockResolvedValue(JSON.stringify(stored("note-stub", "stub", { messages: [{ role: "user", content: "x" }] })));
    const store = useChatsStore.getState();
    await store.load("note-stub", NOTE);
    const body = await store.loadChatBody("stub", NOTE);
    expect(body?.messages).toHaveLength(1);
    expect(useChatsStore.getState().byId("stub", NOTE)?.stub).toBeUndefined();
  });

  it("forgets a scope's shown state but never the workspace", async () => {
    disk.set("note-1", "[]");
    const store = useChatsStore.getState();
    await store.load("note-1", NOTE);
    store.forgetScope(NOTE);
    store.forgetScope(NOTE);
    store.forgetScope(WORKSPACE_CHAT_SCOPE);
    expect(useChatsStore.getState().shownByScope).toEqual({});
  });

  it("drops an older load for the same scope when a newer one finishes first", async () => {
    let release: (value: { json: string; skipped: number }) => void = () => {};
    const tauri = await import("@/lib/tauri");
    vi.mocked(tauri.chatsLoad).mockImplementationOnce(
      () => new Promise((resolve) => {
        release = resolve;
      }),
    );
    disk.set("note-2", JSON.stringify([stored("note-2", "fresh")]));
    const store = useChatsStore.getState();
    const slow = store.load("note-1", NOTE);
    await store.load("note-2", NOTE);
    release({ json: JSON.stringify([stored("note-1", "late")]), skipped: 0 });
    await slow;
    expect(shownChats(useChatsStore.getState(), NOTE).projectId).toBe("note-2");
  });
});
