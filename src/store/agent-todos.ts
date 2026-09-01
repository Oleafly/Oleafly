import { create } from "zustand";
import { E2E_HOOKS } from "@/lib/e2e-flags";

export type AgentTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface AgentTodo {
  id: string;
  content: string;
  status: AgentTodoStatus;
}

export function agentTodoProgress(todos: readonly AgentTodo[]): {
  current: number;
  total: number;
} {
  const active = todos.filter((todo) => todo.status !== "cancelled");
  const inProgress = active.findIndex((todo) => todo.status === "in_progress");
  return {
    current:
      inProgress >= 0
        ? inProgress + 1
        : active.filter((todo) => todo.status === "completed").length,
    total: active.length,
  };
}

interface AgentTodoState {
  projectId: string | null;
  activeChatId: string | null;
  todos: AgentTodo[];
  todosByChat: Record<string, AgentTodo[]>;
  bindProject: (projectId: string | null) => void;
  beginTurn: (chatId: string) => void;
  finishTurn: (chatId: string) => void;
  selectChat: (chatId: string | null) => void;
  setTodos: (todos: AgentTodo[]) => void;
  clear: () => void;
}

// In-run plan checklist the agent maintains via update_todos / get_todos.
export const useAgentTodoStore = create<AgentTodoState>((set) => ({
  projectId: null,
  activeChatId: null,
  todos: [],
  todosByChat: {},
  bindProject: (projectId) =>
    set((state) =>
      state.projectId === projectId
        ? state
        : { projectId, activeChatId: null, todos: [], todosByChat: {} },
    ),
  beginTurn: (chatId) =>
    set((state) => ({
      activeChatId: chatId,
      todos: [],
      todosByChat: { ...state.todosByChat, [chatId]: [] },
    })),
  finishTurn: (chatId) =>
    set((state) => (state.activeChatId === chatId ? { activeChatId: null } : state)),
  selectChat: (chatId) =>
    set((state) => ({
      activeChatId: null,
      todos: chatId ? [...(state.todosByChat[chatId] ?? [])] : [],
    })),
  setTodos: (todos) =>
    set((state) => ({
      todos,
      ...(state.activeChatId
        ? { todosByChat: { ...state.todosByChat, [state.activeChatId]: todos } }
        : {}),
    })),
  clear: () => set({ activeChatId: null, todos: [], todosByChat: {} }),
}));

// E2E / devtools: seed a plan checklist without a model call.
if (typeof window !== "undefined" && E2E_HOOKS) {
  const w = window as unknown as {
    __agentTodosSet?: (todos: AgentTodo[]) => void;
    __agentTodosClear?: () => void;
  };
  w.__agentTodosSet = (todos) => useAgentTodoStore.getState().setTodos(todos);
  w.__agentTodosClear = () => useAgentTodoStore.getState().clear();
}
