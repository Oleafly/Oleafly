import { create } from "zustand";

export type AgentTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface AgentTodo {
  id: string;
  content: string;
  status: AgentTodoStatus;
}

interface AgentTodoState {
  todos: AgentTodo[];
  setTodos: (todos: AgentTodo[]) => void;
  clear: () => void;
}

// In-run plan checklist the agent maintains via update_todos / get_todos.
export const useAgentTodoStore = create<AgentTodoState>((set) => ({
  todos: [],
  setTodos: (todos) => set({ todos }),
  clear: () => set({ todos: [] }),
}));

// E2E / devtools: seed a plan checklist without a model call.
if (typeof window !== "undefined") {
  const w = window as unknown as {
    __agentTodosSet?: (todos: AgentTodo[]) => void;
    __agentTodosClear?: () => void;
  };
  w.__agentTodosSet = (todos) => useAgentTodoStore.getState().setTodos(todos);
  w.__agentTodosClear = () => useAgentTodoStore.getState().clear();
}
