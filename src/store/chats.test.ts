import { describe, it, expect, vi, beforeEach } from "vitest";

// Deferred per-call resolvers so tests control when each disk load lands.
const loadCalls: Array<{ pid: string; resolve: (raw: string) => void }> = [];

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@/lib/tauri", () => ({
  loadProjectChats: vi.fn(
    (pid: string) =>
      new Promise<string>((resolve) => {
        loadCalls.push({ pid, resolve });
      })
  ),
  saveProjectChats: vi.fn(async () => {}),
}));

import { useChatsStore } from "./chats";

const chatJson = (pid: string, id: string) =>
  JSON.stringify([
    { id, projectId: pid, title: "t", createdAt: 1, updatedAt: 1, messages: [] },
  ]);

beforeEach(() => {
  loadCalls.length = 0;
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
    const p = useChatsStore.getState().load("A");
    loadCalls[0].resolve("not json");
    await p;
    const s = useChatsStore.getState();
    expect(s.projectId).toBe("A");
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
});
