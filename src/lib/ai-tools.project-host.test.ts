// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiToolsHost } from "@oleafly/ai-tools";

const mocks = vi.hoisted(() => ({
  hosts: [] as unknown[],
  figureHosts: [] as unknown[],
  projectMutationGeneration: vi.fn(async () => 7),
}));

vi.mock("@oleafly/ai-tools", () => ({
  createOleaflyTools: (host: unknown) => {
    mocks.hosts.push(host);
    return {};
  },
  createFigureTools: (host: unknown) => {
    mocks.figureHosts.push(host);
    return {};
  },
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  projectMutationGeneration: mocks.projectMutationGeneration,
}));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => ({ projectId: "paper", files: {} }) } }));

import { useAgentMemoryStore } from "@/store/agent-memory";
import { agentTodoView, useAgentTodoStore } from "@/store/agent-todos";
import { createFigureTools, createOleaflyTools, createProjectToolsHost } from "./ai-tools";

const SCOPE = "note:note-1";

function host(): AiToolsHost {
  return createProjectToolsHost({ projectId: () => "note-1", scope: SCOPE, unavailable: "Not in a note." });
}

beforeEach(() => {
  mocks.hosts.length = 0;
  mocks.figureHosts.length = 0;
  localStorage.clear();
  useAgentTodoStore.setState({ projectId: null, activeChatId: null, viewChatId: null, todos: [], todosByChat: {}, scopes: {} });
  useAgentMemoryStore.setState({ projectId: null, notes: [], scopes: {} });
});

describe("a tools host for another project", () => {
  it("works on its own project and leaves the open workspace alone", async () => {
    const tools = host();
    expect(tools.getProjectId()).toBe("note-1");
    expect(await tools.prepareExternalMutation("note-1")).toBe(7);
    expect(mocks.projectMutationGeneration).toHaveBeenCalledWith("note-1");
    expect(tools.applyExternalWrite("note-1", "assets/a.csv", "x")).toBe(true);
    expect(tools.applyExternalRename("note-1", "a", "b")).toBe(true);
    expect(tools.applyExternalDelete("note-1", "a")).toBe(true);
    await expect(tools.refreshTree("note-1")).resolves.toBeUndefined();
    expect(() => tools.refreshOpenFiles?.("note-1")).not.toThrow();
    expect(tools.insertAtCursor("note-1", "x")).toBe(false);
    expect(tools.replaceRange("note-1", 0, 1, "x")).toBe(false);
    expect(tools.insertTargetPath?.("note-1")).toBeNull();
    expect(tools.revealLocation).toBeUndefined();
  });

  it("refuses the workspace's compile and main document tools with the reason given", async () => {
    const tools = host();
    await expect(tools.recompile()).rejects.toThrow("Not in a note.");
    await expect(tools.setMainDoc("note-1", "main.tex")).rejects.toThrow("Not in a note.");
    expect(tools.getCompileLog()).toBeNull();
    expect(tools.getPdfBytes()).toBeNull();
    expect(tools.getPdfCursorPage?.()).toBeNull();
    expect(tools.getLastCompileFailure?.()).toBeNull();
    await expect(tools.getProjectIndex()).resolves.toBeNull();
  });

  it("keeps the checklist and memory in its own scope", () => {
    const tools = host();
    useAgentTodoStore.getState().bindProject("note-1", SCOPE);
    useAgentTodoStore.getState().beginTurn("note-chat", { scope: SCOPE });
    tools.setAgentTodos([
      { id: "a", content: "Search", status: "in_progress" },
      { id: "b", content: "Write", status: "someday" },
    ]);
    expect(tools.getAgentTodos()).toEqual([
      { id: "a", content: "Search", status: "in_progress" },
      { id: "b", content: "Write", status: "pending" },
    ]);
    expect(agentTodoView(useAgentTodoStore.getState()).todos).toEqual([]);

    expect(tools.rememberNote("SI units")).toEqual({ error: "No project open or empty note" });
    useAgentMemoryStore.getState().load("note-1", SCOPE);
    const note = tools.rememberNote("SI units") as { id: string; content: string };
    expect(note.content).toBe("SI units");
    expect(tools.listNotes()).toEqual([{ id: note.id, content: "SI units" }]);
    expect(tools.forgetNote(note.id)).toEqual({ success: true });
    expect(tools.listNotes()).toEqual([]);
    expect(useAgentMemoryStore.getState().notes).toEqual([]);
  });

  it("is handed to the core tools when a run supplies it, and the workspace host otherwise", () => {
    const tools = host();
    createOleaflyTools({ host: tools });
    createOleaflyTools();
    createFigureTools({ host: tools });
    createFigureTools();
    expect(mocks.hosts[0]).toBe(tools);
    expect((mocks.hosts[1] as AiToolsHost).getProjectId()).toBe("paper");
    expect(mocks.figureHosts[0]).toBe(tools);
    expect(mocks.figureHosts[1]).not.toBe(tools);
  });
});
