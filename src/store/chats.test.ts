import { describe, it, expect, vi, beforeEach } from "vitest";

// Deferred per-call resolvers so tests control when each disk load lands.
const loadCalls: Array<{ pid: string; resolve: (raw: string) => void }> = [];
const saveProjectChats = vi.hoisted(() => vi.fn(async (_projectId: string, _json: string) => {}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@/lib/tauri", () => ({
  loadProjectChats: vi.fn(
    (pid: string) =>
      new Promise<string>((resolve) => {
        loadCalls.push({ pid, resolve });
      })
  ),
  saveProjectChats,
}));

import { useChatsStore, type ChatUsage, type StoredChat } from "./chats";

const chatJson = (pid: string, id: string) =>
  JSON.stringify([
    { id, projectId: pid, title: "t", createdAt: 1, updatedAt: 1, messages: [] },
  ]);

beforeEach(() => {
  loadCalls.length = 0;
  saveProjectChats.mockClear();
  useChatsStore.setState({ projectId: null, chats: [], activeId: null });
});

describe("chats store load", () => {
  it("applies each project's chats on a normal A to B switch", async () => {
    // Regression: the guard must compare against the latest REQUEST, not the
    // store's own (still stale) projectId, or B's chats never load.
    const pa = useChatsStore.getState().load("A");
    loadCalls[0].resolve(chatJson("A", "a1"));
    await pa;
    expect(useChatsStore.getState().projectId).toBe("A");

    const pb = useChatsStore.getState().load("B");
    loadCalls[1].resolve(chatJson("B", "b1"));
    await pb;
    const s = useChatsStore.getState();
    expect(s.projectId).toBe("B");
    expect(s.chats.map((c) => c.id)).toEqual(["b1"]);
  });

  it("a stale load resolving late cannot clobber the newer project", async () => {
    const pa = useChatsStore.getState().load("A");
    const pb = useChatsStore.getState().load("B");
    loadCalls[1].resolve(chatJson("B", "b1"));
    await pb;
    loadCalls[0].resolve(chatJson("A", "a1"));
    await pa;
    const s = useChatsStore.getState();
    expect(s.projectId).toBe("B");
    expect(s.chats.map((c) => c.id)).toEqual(["b1"]);
  });

  it("malformed disk payloads degrade to an empty list", async () => {
    const p = useChatsStore.getState().load("malformed-project");
    loadCalls[0].resolve("not json");
    await p;
    const s = useChatsStore.getState();
    expect(s.projectId).toBe("malformed-project");
    expect(s.chats).toEqual([]);
  });
});

describe("chats store addUsage", () => {
  it("accumulates token totals per chat across runs", async () => {
    const p = useChatsStore.getState().load("P");
    loadCalls[0].resolve(
      JSON.stringify([
        {
          id: "c1",
          projectId: "P",
          title: "t",
          createdAt: 1,
          updatedAt: 1,
          messages: [],
          headOid: null,
        },
      ]),
    );
    await p;
    useChatsStore.getState().setActive("c1");
    useChatsStore.getState().addUsage("c1", {
      inputTokens: 100,
      outputTokens: 20,
      steps: 2,
      estimatedUsd: 0.01,
    });
    useChatsStore.getState().addUsage("c1", {
      inputTokens: 50,
      outputTokens: 10,
      steps: 1,
      estimatedUsd: 0.005,
    });
    const u = useChatsStore.getState().byId("c1")?.usage;
    expect(u?.inputTokens).toBe(150);
    expect(u?.outputTokens).toBe(30);
    expect(u?.steps).toBe(3);
    expect(u?.runs).toBe(2);
    expect(u?.estimatedUsd).toBeCloseTo(0.015, 6);
  });

  it("persists a completed A run after switching to B without replacing B state", async () => {
    const loadA = useChatsStore.getState().load("A");
    loadCalls[0].resolve(chatJson("A", "a1"));
    await loadA;
    const loadB = useChatsStore.getState().load("B");
    loadCalls[1].resolve(chatJson("B", "b1"));
    await loadB;
    await useChatsStore.getState().addUsageForProject("A", "a1", {
      inputTokens: 80,
      outputTokens: 20,
      steps: 2,
      estimatedUsd: 0.01,
    });
    expect(useChatsStore.getState().projectId).toBe("B");
    expect(useChatsStore.getState().chats.map((chat) => chat.id)).toEqual(["b1"]);
    const persisted = [...saveProjectChats.mock.calls].reverse().find((call) => call[0] === "A");
    expect(persisted).toBeDefined();
    const chats = JSON.parse(persisted?.[1] ?? "[]") as Array<{ id: string; usage?: ChatUsage }>;
    expect(chats.find((chat) => chat.id === "a1")?.usage?.inputTokens).toBe(80);
  });

  it("serializes message and usage saves so the newest combined state is last", async () => {
    const project = "ordered-project";
    const load = useChatsStore.getState().load(project);
    loadCalls[0].resolve(chatJson(project, "ordered-chat"));
    await load;
    let releaseFirst: (() => void) | undefined;
    saveProjectChats.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
    useChatsStore.getState().saveMessages("ordered-chat", [{ role: "user", content: "new text" }]);
    const usage = useChatsStore.getState().addUsageForProject(project, "ordered-chat", {
      inputTokens: 12,
      outputTokens: 3,
      steps: 1,
    });
    await vi.waitFor(() => expect(saveProjectChats).toHaveBeenCalledTimes(1));
    releaseFirst?.();
    await usage;
    expect(saveProjectChats).toHaveBeenCalledTimes(2);
    const final = JSON.parse(saveProjectChats.mock.calls[1][1]) as StoredChat[];
    expect(final[0].messages[0]?.content).toBe("new text");
    expect(final[0].usage?.inputTokens).toBe(12);
  });

  it("keeps usage when messages save immediately before the usage promise resolves", async () => {
    const project = "production-order-project";
    const load = useChatsStore.getState().load(project);
    loadCalls[0].resolve(chatJson(project, "production-order-chat"));
    await load;
    const usage = useChatsStore.getState().addUsageForProject(project, "production-order-chat", {
      inputTokens: 21,
      outputTokens: 5,
      steps: 1,
    });
    useChatsStore.getState().saveMessages("production-order-chat", [{ role: "user", content: "saved immediately" }]);
    await usage;
    await vi.waitFor(() => expect(saveProjectChats).toHaveBeenCalledTimes(2));
    const final = JSON.parse(saveProjectChats.mock.calls[1][1]) as StoredChat[];
    expect(final[0].messages[0]?.content).toBe("saved immediately");
    expect(final[0].usage?.inputTokens).toBe(21);
    expect(useChatsStore.getState().chats[0].messages[0]?.content).toBe("saved immediately");
    expect(useChatsStore.getState().chats[0].usage?.inputTokens).toBe(21);
  });

  it("merges a cache-miss usage delta into memory loaded by a newer request", async () => {
    const project = "cache-race-project";
    const usage = useChatsStore.getState().addUsageForProject(project, "race-chat", {
      inputTokens: 7,
      outputTokens: 2,
      steps: 1,
    });
    const load = useChatsStore.getState().load(project);
    loadCalls[1].resolve(JSON.stringify([{
      id: "race-chat", projectId: project, title: "new", createdAt: 1, updatedAt: 2,
      messages: [{ role: "user", content: "newer memory" }], headOid: null,
    }]));
    await load;
    loadCalls[0].resolve(chatJson(project, "race-chat"));
    await usage;
    const state = useChatsStore.getState();
    expect(state.chats[0].messages[0]?.content).toBe("newer memory");
    expect(state.chats[0].usage?.inputTokens).toBe(7);
  });

  it("keeps the newest A memory when navigation returns from B", async () => {
    const project = "return-a-project";
    const loadA = useChatsStore.getState().load(project);
    loadCalls[0].resolve(chatJson(project, "return-chat"));
    await loadA;
    await useChatsStore.getState().addUsageForProject(project, "return-chat", {
      inputTokens: 9,
      outputTokens: 1,
      steps: 1,
    });
    const loadB = useChatsStore.getState().load("return-b-project");
    loadCalls[1].resolve(chatJson("return-b-project", "return-b-chat"));
    await loadB;
    const returnA = useChatsStore.getState().load(project);
    loadCalls[2].resolve(chatJson(project, "return-chat"));
    await returnA;
    expect(useChatsStore.getState().projectId).toBe(project);
    expect(useChatsStore.getState().chats[0].usage?.inputTokens).toBe(9);
  });
});
