// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useAgentMemoryStore, WORKSPACE_MEMORY_SCOPE } from "./agent-memory";
import { agentTodoView, readStoredTodos, useAgentTodoStore, WORKSPACE_TODO_SCOPE } from "./agent-todos";
import { selectScopeRuntime, useAssistantRuntimeStore, WORKSPACE_RUNTIME_SCOPE } from "./assistant-runtime";

const NOTE = "note:note-1";
const STEP = { id: "a", content: "Search the literature", status: "in_progress" as const };

beforeEach(() => {
  localStorage.clear();
  useAgentTodoStore.setState({
    projectId: null,
    activeChatId: null,
    viewChatId: null,
    todos: [],
    todosByChat: {},
    scopes: {},
  });
  useAgentMemoryStore.setState({ projectId: null, notes: [], scopes: {} });
  useAssistantRuntimeStore.setState({ runtime: "built-in", handoffRuntime: null, runtimeByScope: {} });
});

describe("todos per scope", () => {
  it("keeps the workspace checklist while a note binds its own project and runs a turn", () => {
    const store = useAgentTodoStore.getState();
    store.bindProject("paper");
    store.beginTurn("paper-chat");
    store.setTodos([{ id: "w", content: "Compile", status: "pending" }]);

    store.bindProject("note-1", NOTE);
    store.beginTurn("note-chat", { scope: NOTE });
    store.setTodos([STEP], NOTE);

    const state = useAgentTodoStore.getState();
    expect(state.todos).toEqual([{ id: "w", content: "Compile", status: "pending" }]);
    expect(agentTodoView(state, WORKSPACE_TODO_SCOPE).activeChatId).toBe("paper-chat");
    expect(agentTodoView(state, NOTE)).toMatchObject({ projectId: "note-1", activeChatId: "note-chat", todos: [STEP] });

    store.finishTurn("note-chat", "completed", NOTE);
    expect(agentTodoView(useAgentTodoStore.getState(), NOTE).todos[0].status).toBe("completed");
    expect(readStoredTodos("note-chat")[0].status).toBe("completed");
    expect(useAgentTodoStore.getState().activeChatId).toBe("paper-chat");
  });

  it("keeps a note's chats when the workspace switches project or clears its checklist", () => {
    const store = useAgentTodoStore.getState();
    store.bindProject("note-1", NOTE);
    store.beginTurn("note-chat", { scope: NOTE });
    store.setTodos([STEP], NOTE);
    store.bindProject("paper");
    store.bindProject("other-paper");
    expect(useAgentTodoStore.getState().todosByChat["note-chat"]).toEqual([STEP]);
    store.beginTurn("paper-chat");
    store.setTodos([{ id: "w", content: "Compile", status: "pending" }]);
    store.clear();
    expect(readStoredTodos("paper-chat")).toEqual([]);
    expect(readStoredTodos("note-chat")).toEqual([STEP]);
    store.clear(NOTE);
    expect(readStoredTodos("note-chat")).toEqual([]);
  });

  it("selects a chat and ignores turns it does not own within a scope", () => {
    const store = useAgentTodoStore.getState();
    store.bindProject("note-1", NOTE);
    store.bindProject("note-1", NOTE);
    store.selectChat("note-chat", NOTE);
    store.setTodos([STEP], NOTE);
    store.finishTurn("someone-else", "completed", NOTE);
    expect(agentTodoView(useAgentTodoStore.getState(), NOTE).todos).toEqual([STEP]);
    store.selectChat(null, NOTE);
    expect(agentTodoView(useAgentTodoStore.getState(), NOTE).todos).toEqual([]);
    store.setTodos([STEP], "note:empty");
    expect(agentTodoView(useAgentTodoStore.getState(), "note:empty").todos).toEqual([]);
    store.forgetScope(NOTE);
    store.forgetScope(NOTE);
    store.forgetScope(WORKSPACE_TODO_SCOPE);
    expect(useAgentTodoStore.getState().scopes).toEqual({});
  });
});

describe("memory per scope", () => {
  it("remembers notes for the note project without touching the workspace's", () => {
    const store = useAgentMemoryStore.getState();
    store.load("paper");
    store.add("Cite with natbib");
    store.load("note-1", NOTE);
    const added = store.add("The person prefers SI units", NOTE);
    expect(useAgentMemoryStore.getState().notes.map((note) => note.content)).toEqual(["Cite with natbib"]);
    expect(store.view(NOTE).notes.map((note) => note.content)).toEqual(["The person prefers SI units"]);
    expect(store.asPromptBlock(NOTE)).toContain("1. The person prefers SI units");
    store.remove(added?.id ?? "", NOTE);
    expect(store.view(NOTE).notes).toEqual([]);
    expect(store.asPromptBlock(NOTE)).toBe("");
    store.add("Again", NOTE);
    store.clear(NOTE);
    expect(store.view(NOTE).notes).toEqual([]);
    expect(store.view(WORKSPACE_MEMORY_SCOPE).notes).toHaveLength(1);
    expect(store.view("note:unknown")).toEqual({ projectId: null, notes: [] });
    store.forgetScope(NOTE);
    store.forgetScope(WORKSPACE_MEMORY_SCOPE);
    store.forgetScope(NOTE);
    expect(useAgentMemoryStore.getState().scopes).toEqual({});
  });
});

describe("runtime per scope", () => {
  it("keeps a note's runtime choice apart from the workspace's and defaults new notes to the last pick", () => {
    const store = useAssistantRuntimeStore.getState();
    store.setScopeRuntime(NOTE, "acp");
    const state = () => useAssistantRuntimeStore.getState();
    expect(selectScopeRuntime(WORKSPACE_RUNTIME_SCOPE)(state())).toBe("built-in");
    expect(selectScopeRuntime(NOTE)(state())).toBe("acp");
    expect(selectScopeRuntime("note:new")(state())).toBe("acp");
    store.setScopeRuntime("note:other", "built-in");
    expect(selectScopeRuntime(NOTE)(state())).toBe("acp");
    expect(selectScopeRuntime("note:new")(state())).toBe("built-in");
    store.setScopeRuntime(WORKSPACE_RUNTIME_SCOPE, "acp");
    expect(state().runtime).toBe("acp");
    expect(selectScopeRuntime(NOTE)(state())).toBe("acp");
  });

  it("saves scoped choices, keeps at most a hundred, and reads back only valid ones", async () => {
    const store = useAssistantRuntimeStore.getState();
    for (let index = 0; index < 120; index++) store.setScopeRuntime(`note:${index}`, index % 2 ? "acp" : "built-in");
    const saved = JSON.parse(localStorage.getItem("oleafly.assistant-runtime.v1") ?? "{}") as {
      state: { runtimeByScope: Record<string, string> };
    };
    expect(Object.keys(saved.state.runtimeByScope)).toHaveLength(100);
    expect(saved.state.runtimeByScope["note:119"]).toBe("acp");
    expect(saved.state.runtimeByScope["note:0"]).toBeUndefined();

    localStorage.setItem(
      "oleafly.assistant-runtime.v1",
      JSON.stringify({ state: { runtime: "acp", runtimeByScope: { "note:a": "acp", "note:b": "other" } }, version: 0 }),
    );
    await useAssistantRuntimeStore.persist.rehydrate();
    expect(useAssistantRuntimeStore.getState().runtimeByScope).toEqual({ "note:a": "acp" });
    localStorage.setItem(
      "oleafly.assistant-runtime.v1",
      JSON.stringify({ state: { runtime: "built-in", runtimeByScope: ["bad"] }, version: 0 }),
    );
    await useAssistantRuntimeStore.persist.rehydrate();
    expect(useAssistantRuntimeStore.getState().runtimeByScope).toEqual({});
  });
});
