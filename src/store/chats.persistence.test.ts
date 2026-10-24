// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tauri: true,
  files: new Map<string, Map<string, string>>(),
  skipped: 0,
  chatsLoad: vi.fn(),
  chatRead: vi.fn(),
  chatSave: vi.fn(),
  chatDelete: vi.fn(),
  attachmentGc: vi.fn(),
  agentThreadDelete: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.tauri, invoke: vi.fn() }));
vi.mock("@/lib/tauri", () => ({
  chatsLoad: mocks.chatsLoad,
  chatRead: mocks.chatRead,
  chatSave: mocks.chatSave,
  chatDelete: mocks.chatDelete,
}));
vi.mock("@/lib/attachments", () => ({ attachmentGc: mocks.attachmentGc }));
vi.mock("@/lib/agent-backend", () => ({ agentThreadDelete: mocks.agentThreadDelete }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import type { StoredChat } from "./chats";

type ChatsModule = typeof import("./chats");
type TurnsModule = typeof import("./agent-turns");
type DraftsModule = typeof import("./composer-drafts");

let chatsModule: ChatsModule;
let store: ChatsModule["useChatsStore"];
let turns: TurnsModule["useAgentTurnsStore"];
let drafts: DraftsModule["useComposerDrafts"];

function chat(projectId: string, id: string, updatedAt: number, extra: Partial<StoredChat> = {}): StoredChat {
  return {
    id,
    projectId,
    title: "Saved chat",
    createdAt: updatedAt,
    updatedAt,
    messages: [],
    headOid: null,
    ...extra,
  };
}

function project(projectId: string): Map<string, string> {
  let files = mocks.files.get(projectId);
  if (!files) {
    files = new Map();
    mocks.files.set(projectId, files);
  }
  return files;
}

function putOnDisk(...chats: StoredChat[]) {
  for (const item of chats) project(item.projectId).set(item.id, JSON.stringify(item));
}

function savedOnDisk(projectId: string, chatId: string): StoredChat | undefined {
  const json = mocks.files.get(projectId)?.get(chatId);
  return json ? JSON.parse(json) : undefined;
}

function settle() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  vi.resetModules();
  mocks.tauri = true;
  mocks.files.clear();
  mocks.skipped = 0;
  localStorage.clear();
  mocks.chatsLoad.mockReset().mockImplementation(async (pid: string) => {
    const chats = [...(mocks.files.get(pid)?.values() ?? [])]
      .map((json) => JSON.parse(json) as StoredChat)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return { json: JSON.stringify(chats), skipped: mocks.skipped };
  });
  mocks.chatRead.mockReset().mockImplementation(async (pid: string, id: string) => {
    const json = mocks.files.get(pid)?.get(id);
    if (!json) throw new Error("missing");
    return json;
  });
  mocks.chatSave.mockReset().mockImplementation(async (pid: string, id: string, json: string) => {
    project(pid).set(id, json);
  });
  mocks.chatDelete.mockReset().mockImplementation(async (pid: string, id: string) => {
    mocks.files.get(pid)?.delete(id);
  });
  mocks.attachmentGc.mockReset().mockResolvedValue(0);
  mocks.agentThreadDelete.mockReset().mockResolvedValue(undefined);
  mocks.logError.mockReset();
  chatsModule = await import("./chats");
  store = chatsModule.useChatsStore;
  turns = (await import("./agent-turns")).useAgentTurnsStore;
  drafts = (await import("./composer-drafts")).useComposerDrafts;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("chat persistence on disk", () => {
  it("loads per-chat files newest first and remembers how many were skipped", async () => {
    putOnDisk(chat("p1", "old", 1), chat("p1", "new", 2));
    mocks.skipped = 2;

    await store.getState().load("p1");

    expect(store.getState().chats.map((c) => c.id)).toEqual(["new", "old"]);
    expect(store.getState().skippedOnLoad).toBe(2);
  });

  it("saves only the chat that changed", async () => {
    putOnDisk(chat("p1", "a", 1), chat("p1", "b", 2));
    await store.getState().load("p1");

    store.getState().saveMessages("a", [{ role: "user", content: "hello" }]);
    await settle();

    expect(mocks.chatSave).toHaveBeenCalledTimes(1);
    expect(mocks.chatSave.mock.calls[0].slice(0, 2)).toEqual(["p1", "a"]);
  });

  it("coalesces rapid saves of one chat so the newest state lands last", async () => {
    putOnDisk(chat("p1", "a", 1));
    await store.getState().load("p1");
    let release!: () => void;
    mocks.chatSave.mockImplementationOnce(
      (pid: string, id: string, json: string) =>
        new Promise<void>((resolve) => {
          release = () => {
            project(pid).set(id, json);
            resolve();
          };
        }),
    );

    store.getState().saveMessages("a", [{ role: "user", content: "one" }]);
    store.getState().saveMessages("a", [{ role: "user", content: "two" }]);
    store.getState().saveMessages("a", [{ role: "user", content: "three" }]);
    await settle();
    release();
    await settle();
    await settle();

    expect(mocks.chatSave.mock.calls.length).toBeLessThanOrEqual(2);
    expect(savedOnDisk("p1", "a")?.messages[0].content).toBe("three");
  });

  it("saves streamed replies without indexing and indexes the final save", async () => {
    putOnDisk(chat("p1", "a", 1));
    await store.getState().load("p1");

    store.getState().saveMessages("a", [{ role: "assistant", content: "partial" }], { index: false });
    await settle();
    store.getState().saveMessages("a", [{ role: "assistant", content: "final" }]);
    await settle();

    expect(mocks.chatSave.mock.calls.map((call) => call[3])).toEqual([false, true]);
  });

  it("keeps a chat in memory when it is too large to save and flags it", async () => {
    const failed = vi.fn();
    window.addEventListener("oleafly:chat-save-failed", failed);
    putOnDisk(chat("p1", "a", 1));
    await store.getState().load("p1");
    mocks.chatSave.mockRejectedValueOnce(new Error("[chat_too_large] This chat is larger than the 8 MB save limit."));

    store.getState().saveMessages("a", [{ role: "user", content: "big" }]);
    await settle();

    expect(store.getState().saveProblems.a).toBe("tooLarge");
    expect(store.getState().byId("a")?.messages[0].content).toBe("big");
    expect(failed).not.toHaveBeenCalled();

    store.getState().saveMessages("a", [{ role: "user", content: "smaller" }]);
    await settle();
    expect(store.getState().saveProblems.a).toBeUndefined();
    window.removeEventListener("oleafly:chat-save-failed", failed);
  });

  it("tells the app when a save fails for another reason", async () => {
    const failed = vi.fn();
    window.addEventListener("oleafly:chat-save-failed", failed);
    await store.getState().load("p1");
    mocks.chatSave.mockRejectedValueOnce(new Error("disk full"));

    store.getState().create("p1", null);
    await settle();

    expect(failed).toHaveBeenCalledTimes(1);
    window.removeEventListener("oleafly:chat-save-failed", failed);
  });

  it("never writes a stub back to disk", async () => {
    putOnDisk(chat("p1", "old", 1));
    mocks.chatsLoad.mockResolvedValueOnce({
      json: JSON.stringify([{ ...chat("p1", "old", 1), stub: true, messageCount: 4 }]),
      skipped: 0,
    });
    await store.getState().load("p1");

    store.getState().saveMessages("old", [{ role: "user", content: "x" }]);
    store.getState().addUsage("old", { inputTokens: 1, outputTokens: 1, steps: 1 });
    await settle();

    expect(mocks.chatSave).not.toHaveBeenCalled();
    expect(chatsModule.chatMessageCount(store.getState().byId("old") as StoredChat)).toBe(4);
  });

  it("loads the body of an older chat on demand", async () => {
    putOnDisk(chat("p1", "old", 1, { messages: [{ role: "user", content: "hi" }] }));
    mocks.chatsLoad.mockResolvedValueOnce({
      json: JSON.stringify([{ ...chat("p1", "old", 1), stub: true, messageCount: 1 }]),
      skipped: 0,
    });
    await store.getState().load("p1");

    const body = await store.getState().loadChatBody("old");

    expect(body?.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(store.getState().byId("old")?.stub).toBeUndefined();
  });

  it("collects only attachments nothing still uses", async () => {
    putOnDisk(
      chat("p1", "gone", 1, {
        messages: [{ role: "user", content: "x", attachments: [{ name: "a.png", mediaType: "image/png", sha256: "removed" }] }],
      }),
      chat("p1", "kept", 2, {
        messages: [
          {
            role: "user",
            content: "y",
            attachments: [{ name: "b.pdf", mediaType: "application/pdf", sha256: "other", pageImages: [{ sha256: "page", mime: "image/png" }] }],
            toolCalls: [{ name: "preview_figure", status: "done", imageRef: { sha256: "shot", mime: "image/png" } }],
          },
        ],
      }),
    );
    await store.getState().load("p1");
    drafts.getState().addAttachments("p1:builtin", [
      { id: "d", name: "c.png", mime: "image/png", size: 1, status: "ready", kind: "image", scope: "p1", sha256: "draft" },
    ]);
    turns.getState().queueFollowUp("kept", "later", [
      { id: "q", name: "q.png", mime: "image/png", size: 1, status: "ready", kind: "image", scope: "p1", sha256: "queued" },
    ]);

    store.getState().remove("gone");
    await settle();
    await settle();

    expect(mocks.chatDelete).toHaveBeenCalledWith("p1", "gone");
    const [projectId, keep] = mocks.attachmentGc.mock.calls[0];
    expect(projectId).toBe("p1");
    expect([...keep].sort()).toEqual(["draft", "other", "page", "queued", "shot"]);
  });

  it("skips collection while older chats are still stubs", async () => {
    mocks.chatsLoad.mockResolvedValueOnce({
      json: JSON.stringify([chat("p1", "a", 2), { ...chat("p1", "old", 1), stub: true, messageCount: 3 }]),
      skipped: 0,
    });
    await store.getState().load("p1");

    store.getState().remove("a");
    await settle();
    await settle();

    expect(mocks.chatDelete).toHaveBeenCalledWith("p1", "a");
    expect(mocks.attachmentGc).not.toHaveBeenCalled();
  });

  it("strips stored tool screenshots and keeps old data URL ones", () => {
    const withRef = chat("p1", "a", 1, {
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { name: "preview_figure", status: "done", image: "data:image/png;base64,AA", imageRef: { sha256: "s", mime: "image/png" } },
            { name: "preview_figure", status: "done", image: "data:image/png;base64,BB" },
          ],
        },
      ],
    });
    const disk = chatsModule.chatForDisk(withRef);
    expect(disk.messages[0].toolCalls?.[0]).not.toHaveProperty("image");
    expect(disk.messages[0].toolCalls?.[0].imageRef).toEqual({ sha256: "s", mime: "image/png" });
    expect(disk.messages[0].toolCalls?.[1].image).toBe("data:image/png;base64,BB");
    expect(chatsModule.chatForDisk(chat("p1", "b", 1))).toEqual(chat("p1", "b", 1));
  });

  it("stores a chat's effort and web settings", async () => {
    await store.getState().load("p1");
    const created = store.getState().create("p1", null, { web: { search: true, fetch: true } });
    store.getState().setChatSettings(created.id, { effort: "high" });
    await settle();
    expect(savedOnDisk("p1", created.id)).toMatchObject({ effort: "high", web: { search: true, fetch: true } });

    store.getState().setChatSettings(created.id, { effort: null, web: null });
    await settle();
    expect(savedOnDisk("p1", created.id)).not.toHaveProperty("effort");
    expect(savedOnDisk("p1", created.id)).not.toHaveProperty("web");
  });

  it("adds cache tokens and keeps the latest context", async () => {
    await store.getState().load("p1");
    const created = store.getState().create("p1", null);
    store.getState().addUsage(created.id, {
      inputTokens: 10,
      outputTokens: 2,
      steps: 1,
      cacheReadTokens: 5,
      context: { used: 100, size: 1000 },
    });
    store.getState().addUsage(created.id, {
      inputTokens: 1,
      outputTokens: 1,
      steps: 1,
      cacheReadTokens: 7,
      cacheWriteTokens: 3,
      context: { used: 300, size: 1000 },
    });
    expect(store.getState().byId(created.id)?.usage).toMatchObject({
      inputTokens: 11,
      cacheReadTokens: 12,
      cacheWriteTokens: 3,
      context: { used: 300, size: 1000 },
      runs: 2,
    });
  });

  it("sets a chat's cost from the ledger", async () => {
    await store.getState().load("p1");
    const created = store.getState().create("p1", null);
    store.getState().addUsage(created.id, { inputTokens: 1, outputTokens: 1, steps: 1, estimatedUsd: 0.01 });
    store.getState().setChatCost(created.id, 0.42);
    expect(store.getState().byId(created.id)?.usage?.estimatedUsd).toBe(0.42);
  });

  it("moves chats saved by an older version from local storage to disk", async () => {
    localStorage.setItem("oleafly.chats.p1", JSON.stringify([chat("p1", "old", 1), chat("p1", "newer", 2)]));

    await store.getState().load("p1");

    expect(store.getState().chats.map((c) => c.id)).toEqual(["newer", "old"]);
    expect(savedOnDisk("p1", "old")?.id).toBe("old");
    expect(savedOnDisk("p1", "newer")?.id).toBe("newer");
    expect(localStorage.getItem("oleafly.chats.p1")).toBeNull();
  });

  it("keeps the old local copy when the move to disk fails", async () => {
    localStorage.setItem("oleafly.chats.p1", JSON.stringify([chat("p1", "old", 1)]));
    mocks.chatSave.mockRejectedValueOnce(new Error("disk full"));

    await store.getState().load("p1");

    expect(store.getState().chats.map((c) => c.id)).toEqual(["old"]);
    expect(localStorage.getItem("oleafly.chats.p1")).not.toBeNull();
  });

  it("checks for old local chats only once per project", async () => {
    await store.getState().load("p1");
    localStorage.setItem("oleafly.chats.p1", JSON.stringify([chat("p1", "late", 1)]));

    await store.getState().load("p1");

    expect(store.getState().chats).toEqual([]);
    expect(mocks.chatSave).not.toHaveBeenCalled();
  });

  it("reads the local copy when the disk read fails", async () => {
    localStorage.setItem("oleafly.chats.p1", JSON.stringify([chat("p1", "local", 1)]));
    mocks.chatsLoad.mockRejectedValueOnce(new Error("permission denied"));

    await store.getState().load("p1");

    expect(store.getState().chats.map((c) => c.id)).toEqual(["local"]);
  });

  it("keeps every chat: there is no cap on disk", async () => {
    putOnDisk(...Array.from({ length: 60 }, (_, index) => chat("p1", `c${index}`, index)));
    await store.getState().load("p1");

    store.getState().saveMessages("c59", [{ role: "assistant", content: "done" }]);
    await settle();

    expect(store.getState().chats).toHaveLength(60);
    expect(mocks.chatDelete).not.toHaveBeenCalled();
  });

  it("keeps a just-updated chat first when a later update does not sort", async () => {
    putOnDisk(chat("p1", "old", 1), chat("p1", "mid", 2), chat("p1", "new", 3));
    await store.getState().load("p1");

    store.getState().saveMessages("old", [{ role: "user", content: "hello" }]);
    store.getState().addUsage("old", { inputTokens: 1, outputTokens: 1, steps: 1 });
    store.getState().setChatCost("old", 0.5);
    store.getState().setThreadId("old", "thread-1");
    await settle();

    expect(store.getState().chats.map((c) => c.id)).toEqual(["old", "new", "mid"]);
  });

  it("merges the chat files into a chat created before the first load finished", async () => {
    putOnDisk(chat("p1", "older", 1), chat("p1", "oldest", 0));
    const created = store.getState().create("p1", null);

    await store.getState().load("p1");

    expect(store.getState().chats.map((c) => c.id).sort()).toEqual([created.id, "older", "oldest"].sort());
    // The chat a run is using stays the active one.
    expect(store.getState().activeId).toBe(created.id);
  });

  it("does not bring back a chat that was deleted while the files were read", async () => {
    putOnDisk(chat("p1", "a", 1), chat("p1", "b", 2));
    await store.getState().load("p1");
    let release!: () => void;
    mocks.chatDelete.mockImplementationOnce(
      (pid: string, id: string) =>
        new Promise<void>((resolve) => {
          release = () => {
            mocks.files.get(pid)?.delete(id);
            resolve();
          };
        }),
    );
    store.getState().remove("a");
    await settle();

    await store.getState().load("p1");

    expect(store.getState().chats.map((c) => c.id)).toEqual(["b"]);
    release();
  });

  it("does not collect attachments from a list that never met the chat files", async () => {
    putOnDisk(chat("p1", "hidden", 1, {
      messages: [{ role: "user", content: "x", attachments: [{ name: "a.png", mediaType: "image/png", sha256: "hidden-file" }] }],
    }));
    const created = store.getState().create("p1", null);
    const other = store.getState().create("p1", null);

    store.getState().remove(other.id);
    await settle();
    await settle();
    expect(mocks.attachmentGc).not.toHaveBeenCalled();

    await store.getState().load("p1");
    store.getState().remove(created.id);
    await settle();
    await settle();
    const [, keep] = mocks.attachmentGc.mock.calls[0];
    expect(keep).toContain("hidden-file");
  });

  it("still writes a chat whose project left the cache before its save ran", async () => {
    store.getState().create("p0", null);
    for (let index = 1; index <= 6; index += 1) store.getState().create(`p${index}`, null);
    await settle();

    expect(mocks.chatSave.mock.calls.some((call) => call[0] === "p0")).toBe(true);
  });

  it("drops the cached chats of the least recent projects past the cache size", async () => {
    store.getState().create("p0", null);
    for (let index = 1; index <= 16; index += 1) store.getState().create(`p${index}`, null);
    await settle();
    mocks.files.delete("p0");
    putOnDisk(chat("p0", "from-disk", 5));

    await store.getState().load("p0");

    expect(store.getState().chats.map((c) => c.id)).toEqual(["from-disk"]);
  });
});

describe("chat persistence in the browser", () => {
  beforeEach(() => {
    mocks.tauri = false;
  });

  it("stores chats in local storage and reads them back newest first", async () => {
    const created = store.getState().create("web", null);
    store.getState().saveMessages(created.id, [{ role: "user", content: "first question" }]);
    await settle();

    const stored = JSON.parse(localStorage.getItem("oleafly.chats.web") ?? "[]");
    expect(stored[0]).toMatchObject({ id: created.id, title: "first question" });

    store.setState({ projectId: null, chats: [] });
    await store.getState().load("web");
    expect(store.getState().chats.map((c) => c.id)).toEqual([created.id]);
    expect(mocks.chatsLoad).not.toHaveBeenCalled();
  });

  it("treats unreadable local data as no chats", async () => {
    localStorage.setItem("oleafly.chats.web", JSON.stringify({ chats: [] }));
    await store.getState().load("web");
    expect(store.getState().chats).toEqual([]);

    localStorage.setItem("oleafly.chats.web2", "{not json");
    await store.getState().load("web2");
    expect(store.getState().chats).toEqual([]);
  });

  it("falls back to the newest half when local storage is full", async () => {
    localStorage.setItem("oleafly.chats.web", JSON.stringify(Array.from({ length: 40 }, (_, index) => chat("web", `c${index}`, index))));
    await store.getState().load("web");
    const original = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    store.getState().saveMessages("c39", [{ role: "user", content: "keep me" }]);
    await settle();

    expect(setItem).toHaveBeenCalledTimes(2);
    const kept = JSON.parse(localStorage.getItem("oleafly.chats.web") ?? "[]");
    expect(kept).toHaveLength(25);
    expect(kept[0].id).toBe("c39");
    setItem.mockRestore();
    expect(Storage.prototype.setItem).toBe(original);
  });

  it("reports a full local storage that cannot take even half the chats", async () => {
    const quota = vi.fn();
    window.addEventListener("oleafly:chats-quota-exceeded", quota);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    store.getState().create("web", null);
    await settle();

    expect(quota).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
    window.removeEventListener("oleafly:chats-quota-exceeded", quota);
  });

  it("reads no chats when local storage itself is unavailable", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    await store.getState().load("web");

    expect(store.getState().chats).toEqual([]);
    getItem.mockRestore();
  });
});

describe("chat editing", () => {
  beforeEach(async () => {
    await store.getState().load("p1");
  });

  it("ignores edits while no project is open", () => {
    store.setState({ projectId: null, chats: [chat("p1", "c1", 1)] });

    store.getState().saveMessages("c1", [{ role: "user", content: "x" }]);
    store.getState().patchTitleIfEmpty("c1", "x");
    store.getState().addUsage("c1", { inputTokens: 1, outputTokens: 1, steps: 1 });
    store.getState().remove("c1");
    store.getState().setThreadId("c1", "t1");

    expect(store.getState().chats).toEqual([chat("p1", "c1", 1)]);
    expect(mocks.chatSave).not.toHaveBeenCalled();
  });

  it("titles a new chat from its first user message", () => {
    const created = store.getState().create("p1", "abc123");

    store.getState().saveMessages(created.id, [{ role: "user", content: `  Explain\n\n${"word ".repeat(20)}` }]);

    const title = store.getState().byId(created.id)?.title ?? "";
    expect(title.startsWith("Explain word word")).toBe(true);
    expect(title.endsWith("…")).toBe(true);
    expect(title).toHaveLength(61);
    expect(store.getState().byId(created.id)?.headOid).toBe("abc123");
  });

  it("keeps the default title when the first message is from the assistant", () => {
    const created = store.getState().create("p1", null);

    store.getState().saveMessages(created.id, [{ role: "assistant", content: "Hello" }]);

    expect(store.getState().byId(created.id)?.title).toBe("New chat");
  });

  it("fills a title only while the chat has none", async () => {
    putOnDisk(chat("p2", "named", 0, { title: "Named" }), chat("p2", "blank", 0, { title: "" }));
    await store.getState().load("p2");
    const created = store.getState().create("p2", null);

    store.getState().patchTitleIfEmpty(created.id, "Summarize the results");
    store.getState().patchTitleIfEmpty("named", "Other");
    store.getState().patchTitleIfEmpty("blank", "   ");

    expect(store.getState().byId(created.id)?.title).toBe("Summarize the results");
    expect(store.getState().byId("named")?.title).toBe("Named");
    expect(store.getState().byId("blank")?.title).toBe("New chat");
  });

  it("adds non-negative usage only to a chat of the open project", () => {
    const created = store.getState().create("p1", null);

    store.getState().addUsage(created.id, { inputTokens: 10, outputTokens: -5, steps: Number.NaN, estimatedUsd: 0.25 });
    store.getState().addUsage("missing", { inputTokens: 99, outputTokens: 99, steps: 99 });

    expect(store.getState().byId(created.id)?.usage).toEqual({
      inputTokens: 10,
      outputTokens: 0,
      steps: 0,
      runs: 1,
      estimatedUsd: 0.25,
    });
  });

  it("records usage for a background project read from disk", async () => {
    putOnDisk(chat("other", "bg", 3));

    await store.getState().addUsageForProject("other", "bg", { inputTokens: 4, outputTokens: 6, steps: 2 });
    await store.getState().addUsageForProject("other", "missing", { inputTokens: 4, outputTokens: 6, steps: 2 });
    await settle();

    expect(store.getState().projectId).toBe("p1");
    expect(savedOnDisk("other", "bg")?.usage).toEqual({
      inputTokens: 4,
      outputTokens: 6,
      steps: 2,
      runs: 1,
      estimatedUsd: 0,
    });
  });

  it("skips saving a thread id that is already recorded", async () => {
    const created = store.getState().create("p1", null);
    store.getState().setThreadId(created.id, "thread-1");
    await settle();
    mocks.chatSave.mockClear();

    store.getState().setThreadId(created.id, "thread-1");
    await settle();

    expect(mocks.chatSave).not.toHaveBeenCalled();
    expect(store.getState().byId(created.id)?.threadId).toBe("thread-1");
  });

  it("removes a chat without deleting its thread when asked to keep it", () => {
    const created = store.getState().create("p1", null);
    turns.setState({ threadByChat: { [created.id]: "thread-live" } });

    store.getState().remove(created.id, { deleteThread: false });

    expect(store.getState().chats).toEqual([]);
    expect(store.getState().activeId).toBeNull();
    expect(mocks.agentThreadDelete).not.toHaveBeenCalled();
    expect(turns.getState().threadByChat[created.id]).toBeUndefined();
  });

  it("deletes the in-session thread of a chat that was never saved with one", () => {
    const created = store.getState().create("p1", null);
    const other = store.getState().create("p1", null);
    turns.setState({ threadByChat: { [created.id]: "thread-live" } });

    store.getState().remove(created.id);

    expect(mocks.agentThreadDelete).toHaveBeenCalledWith("thread-live");
    expect(store.getState().activeId).toBe(other.id);
  });
});

describe("chat test hooks", () => {
  const hooks = () =>
    window as unknown as {
      __chatStartFresh: () => string | null;
      __chatUsageAdd: (chatId: string, delta: { inputTokens: number; outputTokens: number; steps: number }) => void;
      __chatUsageGet: (chatId: string) => unknown;
      __chatEnsureAndUsage: (delta: { inputTokens: number; outputTokens: number; steps: number }) => unknown;
    };

  it("does nothing without an open project", () => {
    expect(hooks().__chatStartFresh()).toBeNull();
    expect(hooks().__chatEnsureAndUsage({ inputTokens: 1, outputTokens: 1, steps: 1 })).toBeNull();
    expect(hooks().__chatUsageGet("missing")).toBeNull();
  });

  it("starts chats and reports their usage", async () => {
    await store.getState().load("p1");

    const ensured = hooks().__chatEnsureAndUsage({ inputTokens: 2, outputTokens: 3, steps: 1 });
    expect(ensured).toMatchObject({ inputTokens: 2, outputTokens: 3, runs: 1 });

    const fresh = hooks().__chatStartFresh();
    expect(fresh).toEqual(expect.any(String));
    store.getState().setActive(fresh);
    hooks().__chatUsageAdd(fresh ?? "", { inputTokens: 5, outputTokens: 0, steps: 2 });
    expect(hooks().__chatEnsureAndUsage({ inputTokens: 1, outputTokens: 0, steps: 0 })).toMatchObject({
      inputTokens: 6,
      runs: 2,
    });
    expect(hooks().__chatUsageGet(fresh ?? "")).toMatchObject({ inputTokens: 6 });
  });
});
