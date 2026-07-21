import { create } from "zustand";

const MAX_NOTES = 40;
const MAX_NOTE_CHARS = 400;

export interface AgentMemoryNote {
  id: string;
  content: string;
  createdAt: number;
}

interface AgentMemoryState {
  projectId: string | null;
  notes: AgentMemoryNote[];
  load: (projectId: string) => void;
  add: (content: string) => AgentMemoryNote | null;
  remove: (id: string) => void;
  clear: () => void;
  asPromptBlock: () => string;
}

function key(pid: string) {
  return `oleafly.agent-memory.${pid}`;
}

function read(pid: string): AgentMemoryNote[] {
  try {
    const raw = localStorage.getItem(key(pid));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(pid: string, notes: AgentMemoryNote[]) {
  try {
    localStorage.setItem(key(pid), JSON.stringify(notes.slice(0, MAX_NOTES)));
  } catch {
    /* quota */
  }
}

let seq = 1;

export const useAgentMemoryStore = create<AgentMemoryState>((set, get) => ({
  projectId: null,
  notes: [],
  load: (projectId) => {
    set({ projectId, notes: read(projectId) });
  },
  add: (content) => {
    const pid = get().projectId;
    if (!pid) return null;
    const text = content.trim().slice(0, MAX_NOTE_CHARS);
    if (!text) return null;
    const note: AgentMemoryNote = {
      id: `m${Date.now().toString(36)}${seq++}`,
      content: text,
      createdAt: Date.now(),
    };
    const notes = [note, ...get().notes].slice(0, MAX_NOTES);
    write(pid, notes);
    set({ notes });
    return note;
  },
  remove: (id) => {
    const pid = get().projectId;
    if (!pid) return;
    const notes = get().notes.filter((n) => n.id !== id);
    write(pid, notes);
    set({ notes });
  },
  clear: () => {
    const pid = get().projectId;
    if (!pid) return;
    write(pid, []);
    set({ notes: [] });
  },
  asPromptBlock: () => {
    const notes = get().notes;
    if (!notes.length) return "";
    const lines = notes
      .slice(0, 20)
      .map((n, i) => `${i + 1}. ${n.content}`);
    return [
      "### Project agent memory (sticky notes; honor unless the user overrides)",
      ...lines,
    ].join("\n");
  },
}));

// E2E / devtools hooks for sticky memory without going through the model.
if (typeof window !== "undefined") {
  const w = window as unknown as {
    __agentMemoryLoad?: (projectId: string) => void;
    __agentMemoryAdd?: (content: string) => string | null;
    __agentMemoryList?: () => string[];
    __agentMemoryClear?: () => void;
  };
  w.__agentMemoryLoad = (projectId) => useAgentMemoryStore.getState().load(projectId);
  w.__agentMemoryAdd = (content) => useAgentMemoryStore.getState().add(content)?.id ?? null;
  w.__agentMemoryList = () => useAgentMemoryStore.getState().notes.map((n) => n.content);
  w.__agentMemoryClear = () => useAgentMemoryStore.getState().clear();
}
