import { beforeEach, describe, expect, it } from "vitest";
import { agentTodoProgress, useAgentTodoStore } from "./agent-todos";

beforeEach(() => {
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
