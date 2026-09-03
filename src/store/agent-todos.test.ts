// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { agentTodoProgress, readStoredTodos, useAgentTodoStore } from "./agent-todos";

beforeEach(() => {
  localStorage.clear();
  useAgentTodoStore.setState({
    projectId: null,
    activeChatId: null,
    todos: [],
    todosByChat: {},
  });
});

describe("agent todo progress", () => {
  it("uses the current non-cancelled step and excludes cancelled work from the total", () => {
    expect(
      agentTodoProgress([
        { id: "done", content: "Inspect", status: "completed" },
        { id: "cancelled", content: "Discarded", status: "cancelled" },
        { id: "active", content: "Edit", status: "in_progress" },
        { id: "pending", content: "Verify", status: "pending" },
      ]),
    ).toEqual({ current: 2, total: 3 });
  });

  it("reports completed progress when no step is active", () => {
    expect(
      agentTodoProgress([
        { id: "done", content: "Inspect", status: "completed" },
        { id: "pending", content: "Verify", status: "pending" },
      ]),
    ).toEqual({ current: 1, total: 2 });
  });
});

describe("todo project binding", () => {
  it("keeps the last checklist across a same-project remount and clears it for another project", () => {
    useAgentTodoStore.getState().bindProject("project-1");
    useAgentTodoStore.getState().setTodos([
      { id: "done", content: "Finished step", status: "completed" },
    ]);

    useAgentTodoStore.getState().bindProject("project-1");
    expect(useAgentTodoStore.getState().todos).toHaveLength(1);

    useAgentTodoStore.getState().bindProject("project-2");
    expect(useAgentTodoStore.getState().todos).toEqual([]);
  });

  it("restores the last checklist for each chat", () => {
    const store = useAgentTodoStore.getState();
    store.bindProject("project-1");
    store.beginTurn("chat-a");
    store.setTodos([{ id: "a", content: "Chat A step", status: "completed" }]);
    store.finishTurn("chat-a");

    store.selectChat("chat-b");
    expect(useAgentTodoStore.getState().todos).toEqual([]);
    useAgentTodoStore.getState().beginTurn("chat-b");
    useAgentTodoStore
      .getState()
      .setTodos([{ id: "b", content: "Chat B step", status: "in_progress" }]);
    useAgentTodoStore.getState().finishTurn("chat-b");

    useAgentTodoStore.getState().selectChat("chat-a");
    expect(useAgentTodoStore.getState().todos).toEqual([
      { id: "a", content: "Chat A step", status: "completed" },
    ]);
  });
});

describe("plan carry-over and persistence", () => {
  it("keeps the chat checklist when a turn begins with keep", () => {
    const store = useAgentTodoStore.getState();
    store.bindProject("project-1");
    store.beginTurn("chat-a");
    store.setTodos([{ id: "a", content: "Edit the intro", status: "pending" }]);
    store.finishTurn("chat-a");

    useAgentTodoStore.getState().beginTurn("chat-a", { keep: true });
    expect(useAgentTodoStore.getState().todos).toEqual([
      { id: "a", content: "Edit the intro", status: "pending" },
    ]);

    useAgentTodoStore.getState().beginTurn("chat-a");
    expect(useAgentTodoStore.getState().todos).toEqual([]);
  });

  it("persists the checklist per chat and restores it after a reload", () => {
    const store = useAgentTodoStore.getState();
    store.bindProject("project-1");
    store.beginTurn("chat-a");
    store.setTodos([{ id: "a", content: "Edit the intro", status: "pending" }]);
    store.finishTurn("chat-a");
    expect(readStoredTodos("chat-a")).toEqual([
      { id: "a", content: "Edit the intro", status: "pending" },
    ]);

    useAgentTodoStore.setState({
      projectId: null,
      activeChatId: null,
      todos: [],
      todosByChat: {},
    });
    useAgentTodoStore.getState().selectChat("chat-a");
    expect(useAgentTodoStore.getState().todos).toEqual([
      { id: "a", content: "Edit the intro", status: "pending" },
    ]);
  });

  it("wipes the stored checklist when a turn begins without keep", () => {
    const store = useAgentTodoStore.getState();
    store.bindProject("project-1");
    store.beginTurn("chat-a");
    store.setTodos([{ id: "a", content: "Edit the intro", status: "pending" }]);
    store.finishTurn("chat-a");

    useAgentTodoStore.getState().beginTurn("chat-a");

    expect(readStoredTodos("chat-a")).toEqual([]);
    expect(useAgentTodoStore.getState().todos).toEqual([]);

    useAgentTodoStore.setState({
      projectId: null,
      activeChatId: null,
      todos: [],
      todosByChat: {},
    });
    useAgentTodoStore.getState().selectChat("chat-a");
    expect(useAgentTodoStore.getState().todos).toEqual([]);
  });

  it("drops malformed stored entries and clears storage with the checklist", () => {
    localStorage.setItem(
      "oleafly.agent-todos.chat-a",
      JSON.stringify([{ id: "a", content: "Ok", status: "pending" }, { id: 1 }, "x"]),
    );
    expect(readStoredTodos("chat-a")).toEqual([{ id: "a", content: "Ok", status: "pending" }]);
    localStorage.setItem("oleafly.agent-todos.chat-b", "{not json");
    expect(readStoredTodos("chat-b")).toEqual([]);

    const store = useAgentTodoStore.getState();
    store.bindProject("project-1");
    store.beginTurn("chat-a", { keep: true });
    store.finishTurn("chat-a");
    useAgentTodoStore.getState().clear();
    expect(localStorage.getItem("oleafly.agent-todos.chat-a")).toBeNull();
    expect(useAgentTodoStore.getState().todos).toEqual([]);
  });
});
