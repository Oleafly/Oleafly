import { create } from "zustand";
import { E2E_HOOKS } from "@/lib/e2e-flags";

export type AgentTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface AgentTodo {
  id: string;
  content: string;
  status: AgentTodoStatus;
}

export type AgentTurnOutcome = "completed" | "paused";

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

export function settleAgentTodos(
  todos: readonly AgentTodo[],
  outcome: AgentTurnOutcome,
): AgentTodo[] {
  const settled: AgentTodoStatus = outcome === "completed" ? "completed" : "pending";
  return todos.map((todo) =>
    todo.status === "in_progress" ? { ...todo, status: settled } : todo,
  );
}

const STORAGE_PREFIX = "oleafly.agent-todos.";

const storageKey = (chatId: string) => `${STORAGE_PREFIX}${chatId}`;

const TODO_STATUSES = new Set<AgentTodoStatus>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

function isAgentTodo(value: unknown): value is AgentTodo {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.content === "string" &&
    typeof record.status === "string" &&
    TODO_STATUSES.has(record.status as AgentTodoStatus)
  );
}

export function readStoredTodos(chatId: string): AgentTodo[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(storageKey(chatId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isAgentTodo) : [];
  } catch {
    return [];
  }
}

function writeStoredTodos(chatId: string, todos: readonly AgentTodo[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (todos.length === 0) localStorage.removeItem(storageKey(chatId));
    else localStorage.setItem(storageKey(chatId), JSON.stringify(todos));
  } catch {
    return;
  }
}

interface AgentTodoState {
  projectId: string | null;
  activeChatId: string | null;
  viewChatId: string | null;
  todos: AgentTodo[];
  todosByChat: Record<string, AgentTodo[]>;
  bindProject: (projectId: string | null) => void;
  beginTurn: (chatId: string, options?: { keep?: boolean }) => void;
  finishTurn: (chatId: string, outcome?: AgentTurnOutcome) => void;
  selectChat: (chatId: string | null) => void;
  todosForChat: (chatId: string) => AgentTodo[];
  setTodos: (todos: AgentTodo[]) => void;
  clear: () => void;
}

// In-run plan checklist the agent maintains via update_todos / get_todos.
export const useAgentTodoStore = create<AgentTodoState>((set, get) => ({
  projectId: null,
  activeChatId: null,
  viewChatId: null,
  todos: [],
  todosByChat: {},
  bindProject: (projectId) =>
    set((state) =>
      state.projectId === projectId
        ? state
        : { projectId, viewChatId: null, todos: [], todosByChat: {} },
    ),
  beginTurn: (chatId, options) =>
    set((state) => {
      const todos = options?.keep ? get().todosForChat(chatId) : [];
      if (!options?.keep) writeStoredTodos(chatId, []);
      return {
        activeChatId: chatId,
        viewChatId: chatId,
        todos,
        todosByChat: { ...state.todosByChat, [chatId]: todos },
      };
    }),
  finishTurn: (chatId, outcome = "completed") =>
    set((state) => {
      if (state.activeChatId !== chatId) return state;
      const settled = settleAgentTodos(get().todosForChat(chatId), outcome);
      writeStoredTodos(chatId, settled);
      return {
        activeChatId: null,
        todos: state.viewChatId === chatId ? settled : state.todos,
        todosByChat: { ...state.todosByChat, [chatId]: settled },
      };
    }),
  selectChat: (chatId) =>
    set(() => ({
      viewChatId: chatId,
      todos: chatId ? [...get().todosForChat(chatId)] : [],
    })),
  todosForChat: (chatId) => get().todosByChat[chatId] ?? readStoredTodos(chatId),
  setTodos: (todos) =>
    set((state) => {
      const chatId = state.activeChatId ?? state.viewChatId;
      if (!chatId) return state;
      writeStoredTodos(chatId, todos);
      return {
        todos: state.viewChatId === chatId ? todos : state.todos,
        todosByChat: { ...state.todosByChat, [chatId]: todos },
      };
    }),
  clear: () =>
    set((state) => {
      for (const chatId of Object.keys(state.todosByChat)) writeStoredTodos(chatId, []);
      return { activeChatId: null, todos: [], todosByChat: {} };
    }),
}));

// E2E / devtools: seed a plan checklist without a model call.
if (typeof window !== "undefined" && E2E_HOOKS) {
  const w = window as unknown as {
    __agentTodosSet?: (todos: AgentTodo[]) => void;
    __agentTodosClear?: () => void;
  };
  w.__agentTodosSet = (todos) => useAgentTodoStore.setState({ todos });
  w.__agentTodosClear = () => useAgentTodoStore.getState().clear();
}
