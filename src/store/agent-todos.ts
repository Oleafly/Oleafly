import { create } from "zustand";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { readJson, removeKey, writeJson } from "@/lib/local-storage";

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
  return readJson<AgentTodo[]>(storageKey(chatId), [], (parsed) =>
    Array.isArray(parsed) ? parsed.filter(isAgentTodo) : [],
  );
}

function writeStoredTodos(chatId: string, todos: readonly AgentTodo[]): void {
  if (todos.length === 0) removeKey(storageKey(chatId));
  else writeJson(storageKey(chatId), todos);
}

export const WORKSPACE_TODO_SCOPE = "workspace";

export interface AgentTodoView {
  projectId: string | null;
  activeChatId: string | null;
  viewChatId: string | null;
  todos: AgentTodo[];
}

const EMPTY_VIEW: AgentTodoView = { projectId: null, activeChatId: null, viewChatId: null, todos: [] };

interface AgentTodoState extends AgentTodoView {
  todosByChat: Record<string, AgentTodo[]>;
  scopes: Readonly<Record<string, AgentTodoView>>;
  bindProject: (projectId: string | null, scope?: string) => void;
  beginTurn: (chatId: string, options?: { keep?: boolean; scope?: string }) => void;
  finishTurn: (chatId: string, outcome?: AgentTurnOutcome, scope?: string) => void;
  selectChat: (chatId: string | null, scope?: string) => void;
  todosForChat: (chatId: string) => AgentTodo[];
  setTodos: (todos: AgentTodo[], scope?: string) => void;
  clear: (scope?: string) => void;
  forgetScope: (scope: string) => void;
}

type ViewState = Pick<
  AgentTodoState,
  "projectId" | "activeChatId" | "viewChatId" | "todos" | "scopes"
>;

export function agentTodoView(state: ViewState, scope: string = WORKSPACE_TODO_SCOPE): AgentTodoView {
  if (scope === WORKSPACE_TODO_SCOPE) {
    return {
      projectId: state.projectId,
      activeChatId: state.activeChatId,
      viewChatId: state.viewChatId,
      todos: state.todos,
    };
  }
  return state.scopes[scope] ?? EMPTY_VIEW;
}

function withView(state: ViewState, scope: string, patch: Partial<AgentTodoView>): Partial<ViewState> {
  if (scope === WORKSPACE_TODO_SCOPE) return patch;
  return { scopes: { ...state.scopes, [scope]: { ...(state.scopes[scope] ?? EMPTY_VIEW), ...patch } } };
}

function otherScopeChats(state: ViewState, scope: string): Set<string> {
  const chats = new Set<string>();
  const views = [
    ...(scope === WORKSPACE_TODO_SCOPE ? [] : [agentTodoView(state)]),
    ...Object.entries(state.scopes).filter(([key]) => key !== scope).map(([, view]) => view),
  ];
  for (const view of views) {
    if (view.activeChatId) chats.add(view.activeChatId);
    if (view.viewChatId) chats.add(view.viewChatId);
  }
  return chats;
}

export const useAgentTodoStore = create<AgentTodoState>((set, get) => ({
  projectId: null,
  activeChatId: null,
  viewChatId: null,
  todos: [],
  todosByChat: {},
  scopes: {},
  bindProject: (projectId, scope = WORKSPACE_TODO_SCOPE) =>
    set((state) => {
      if (agentTodoView(state, scope).projectId === projectId) return state;
      const keep = otherScopeChats(state, scope);
      return {
        ...withView(state, scope, { projectId, viewChatId: null, todos: [] }),
        todosByChat: Object.fromEntries(
          Object.entries(state.todosByChat).filter(([chatId]) => keep.has(chatId)),
        ),
      };
    }),
  beginTurn: (chatId, options) =>
    set((state) => {
      const todos = options?.keep ? get().todosForChat(chatId) : [];
      if (!options?.keep) writeStoredTodos(chatId, []);
      return {
        ...withView(state, options?.scope ?? WORKSPACE_TODO_SCOPE, {
          activeChatId: chatId,
          viewChatId: chatId,
          todos,
        }),
        todosByChat: { ...state.todosByChat, [chatId]: todos },
      };
    }),
  finishTurn: (chatId, outcome = "completed", scope = WORKSPACE_TODO_SCOPE) =>
    set((state) => {
      const view = agentTodoView(state, scope);
      if (view.activeChatId !== chatId) return state;
      const settled = settleAgentTodos(get().todosForChat(chatId), outcome);
      writeStoredTodos(chatId, settled);
      return {
        ...withView(state, scope, {
          activeChatId: null,
          todos: view.viewChatId === chatId ? settled : view.todos,
        }),
        todosByChat: { ...state.todosByChat, [chatId]: settled },
      };
    }),
  selectChat: (chatId, scope = WORKSPACE_TODO_SCOPE) =>
    set((state) =>
      withView(state, scope, {
        viewChatId: chatId,
        todos: chatId ? [...get().todosForChat(chatId)] : [],
      }),
    ),
  todosForChat: (chatId) => get().todosByChat[chatId] ?? readStoredTodos(chatId),
  setTodos: (todos, scope = WORKSPACE_TODO_SCOPE) =>
    set((state) => {
      const view = agentTodoView(state, scope);
      const chatId = view.activeChatId ?? view.viewChatId;
      if (!chatId) return state;
      writeStoredTodos(chatId, todos);
      return {
        ...withView(state, scope, { todos: view.viewChatId === chatId ? todos : view.todos }),
        todosByChat: { ...state.todosByChat, [chatId]: todos },
      };
    }),
  clear: (scope = WORKSPACE_TODO_SCOPE) =>
    set((state) => {
      const keep = otherScopeChats(state, scope);
      const kept: Record<string, AgentTodo[]> = {};
      for (const [chatId, todos] of Object.entries(state.todosByChat)) {
        if (keep.has(chatId)) kept[chatId] = todos;
        else writeStoredTodos(chatId, []);
      }
      return {
        ...withView(state, scope, { activeChatId: null, todos: [] }),
        todosByChat: kept,
      };
    }),
  forgetScope: (scope) =>
    set((state) => {
      if (scope === WORKSPACE_TODO_SCOPE || !(scope in state.scopes)) return state;
      const { [scope]: _gone, ...scopes } = state.scopes;
      return { scopes };
    }),
}));

if (typeof window !== "undefined" && E2E_HOOKS) {
  const w = window as unknown as {
    __agentTodosSet?: (todos: AgentTodo[]) => void;
    __agentTodosClear?: () => void;
  };
  w.__agentTodosSet = (todos) => useAgentTodoStore.setState({ todos });
  w.__agentTodosClear = () => useAgentTodoStore.getState().clear();
}
