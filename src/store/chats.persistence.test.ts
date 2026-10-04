// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tauri: true,
  disk: new Map<string, string>(),
  loadProjectChats: vi.fn(),
  saveProjectChats: vi.fn(),
  agentThreadDelete: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.tauri }));
vi.mock("@/lib/tauri", () => ({
  loadProjectChats: mocks.loadProjectChats,
  saveProjectChats: mocks.saveProjectChats,
}));
vi.mock("@/lib/agent-backend", () => ({ agentThreadDelete: mocks.agentThreadDelete }));

import type { StoredChat } from "./chats";

type ChatsModule = typeof import("./chats");
type TurnsModule = typeof import("./agent-turns");

let store: ChatsModule["useChatsStore"];
let turns: TurnsModule["useAgentTurnsStore"];

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

function savedOnDisk(projectId: string): StoredChat[] {
  const calls = mocks.saveProjectChats.mock.calls.filter(([pid]) => pid === projectId);
  return JSON.parse(String(calls.at(-1)?.[1] ?? "[]"));
}

function settle() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  vi.resetModules();
  mocks.tauri = true;
  mocks.disk.clear();
  localStorage.clear();
  mocks.loadProjectChats.mockReset().mockImplementation(async (pid: string) => mocks.disk.get(pid) ?? "");
  mocks.saveProjectChats.mockReset().mockImplementation(async (pid: string, json: string) => {
    mocks.disk.set(pid, json);
  });
  mocks.agentThreadDelete.mockReset().mockResolvedValue(undefined);
  store = (await import("./chats")).useChatsStore;
  turns = (await import("./agent-turns")).useAgentTurnsStore;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("chat persistence on disk", () => {
  it("moves chats saved by an older version from local storage to disk", async () => {
    localStorage.setItem("oleafly.chats.p1", JSON.stringify([chat("p1", "old", 1), chat("p1", "newer", 2)]));

    await store.getState().load("p1");

    expect(store.getState().chats.map((c) => c.id)).toEqual(["newer", "old"]);
    expect(savedOnDisk("p1").map((c) => c.id)).toEqual(["newer", "old"]);
    expect(localStorage.getItem("oleafly.chats.p1")).toBeNull();
  });

  it("keeps the old local copy when the move to disk fails", async () => {
    localStorage.setItem("oleafly.chats.p1", JSON.stringify([chat("p1", "old", 1)]));
    mocks.saveProjectChats.mockRejectedValueOnce(new Error("disk full"));

    await store.getState().load("p1");

    expect(store.getState().chats.map((c) => c.id)).toEqual(["old"]);
    expect(localStorage.getItem("oleafly.chats.p1")).not.toBeNull();
  });

  it("checks for old local chats only once per project", async () => {
    await store.getState().load("p1");
    localStorage.setItem("oleafly.chats.p1", JSON.stringify([chat("p1", "late", 1)]));

    await store.getState().load("p1");

    expect(store.getState().chats).toEqual([]);
    expect(mocks.saveProjectChats).not.toHaveBeenCalled();
  });

  it("forgets the migration check for the least recent of more than 16 projects", async () => {
    for (let index = 0; index < 17; index += 1) await store.getState().load(`p${index}`);
    localStorage.setItem("oleafly.chats.p0", JSON.stringify([chat("p0", "late", 1)]));

    await store.getState().load("p0");

    expect(store.getState().chats.map((c) => c.id)).toEqual(["late"]);
    expect(savedOnDisk("p0").map((c) => c.id)).toEqual(["late"]);
  });

  it("reads the local copy when the disk read fails", async () => {
    localStorage.setItem("oleafly.chats.p1", JSON.stringify([chat("p1", "local", 1)]));
    mocks.loadProjectChats.mockRejectedValueOnce(new Error("permission denied"));

    await store.getState().load("p1");

    expect(store.getState().chats.map((c) => c.id)).toEqual(["local"]);
  });

  it("retries a failed save with the newest half of the chats", async () => {
    mocks.disk.set("p1", JSON.stringify(Array.from({ length: 50 }, (_, index) => chat("p1", `c${index}`, index))));
    await store.getState().load("p1");
    mocks.saveProjectChats.mockRejectedValueOnce(new Error("too large"));

    store.getState().saveMessages("c0", [{ role: "user", content: "hello" }]);
    await settle();

    expect(mocks.saveProjectChats).toHaveBeenCalledTimes(2);
    const kept = savedOnDisk("p1");
    expect(kept).toHaveLength(25);
    expect(kept[0].id).toBe("c0");
  });

  it("tells the app when chats cannot be saved at all", async () => {
    const quota = vi.fn();
    window.addEventListener("oleafly:chats-quota-exceeded", quota);
    await store.getState().load("p1");
    mocks.saveProjectChats.mockRejectedValue(new Error("disk full"));

    store.getState().create("p1", null);
    await settle();

    expect(quota).toHaveBeenCalledTimes(1);
    window.removeEventListener("oleafly:chats-quota-exceeded", quota);
  });

  it("saves at most the 50 most recent chats", async () => {
    mocks.disk.set("p1", JSON.stringify(Array.from({ length: 60 }, (_, index) => chat("p1", `c${index}`, index))));
    await store.getState().load("p1");

    store.getState().saveMessages("c59", [{ role: "assistant", content: "done" }]);
    await settle();

    const kept = savedOnDisk("p1");
    expect(kept).toHaveLength(50);
    expect(kept.some((c) => c.id === "c0")).toBe(false);
  });

  it("drops the cached chats of the least recent of more than 16 projects", async () => {
    store.getState().create("p0", null);
    for (let index = 1; index <= 16; index += 1) store.getState().create(`p${index}`, null);
    await settle();
    mocks.disk.set("p0", JSON.stringify([chat("p0", "from-disk", 5)]));

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
    expect(mocks.loadProjectChats).not.toHaveBeenCalled();
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
    expect(mocks.saveProjectChats).not.toHaveBeenCalled();
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
    mocks.disk.set("p2", JSON.stringify([chat("p2", "named", 0, { title: "Named" }), chat("p2", "blank", 0, { title: "" })]));
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
    mocks.disk.set("other", JSON.stringify([chat("other", "bg", 3)]));

    await store.getState().addUsageForProject("other", "bg", { inputTokens: 4, outputTokens: 6, steps: 2 });
    await store.getState().addUsageForProject("other", "missing", { inputTokens: 4, outputTokens: 6, steps: 2 });

    expect(store.getState().projectId).toBe("p1");
    expect(savedOnDisk("other")[0].usage).toEqual({
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
    mocks.saveProjectChats.mockClear();

    store.getState().setThreadId(created.id, "thread-1");

    expect(mocks.saveProjectChats).not.toHaveBeenCalled();
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
