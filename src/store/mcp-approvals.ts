import { create } from "zustand";
import type { ToolApprovalRequest } from "@/lib/ai-tools";

const AUTO_APPROVABLE_TOOLS = new Set([
  "write_file",
  "replace_in_file",
  "create_file",
  "rename_file",
]);

export function isAutoApprovable(tool: string): boolean {
  return AUTO_APPROVABLE_TOOLS.has(tool);
}

export interface PendingApproval {
  id: number;
  req: ToolApprovalRequest;
}

interface McpApprovalState {
  queue: PendingApproval[];
  sessionAutoApprove: boolean;
  request(req: ToolApprovalRequest): Promise<boolean>;
  decide(id: number, approved: boolean): void;
  approveSession(id: number): void;
  setSessionAutoApprove(v: boolean): void;
  cancelAll(): void;
}

let nextId = 1;
const resolvers = new Map<number, (ok: boolean) => void>();

export const useMcpApprovalStore = create<McpApprovalState>((set, get) => ({
  queue: [],
  sessionAutoApprove: false,
  request(req) {
    if (get().sessionAutoApprove && isAutoApprovable(req.tool)) {
      return Promise.resolve(true);
    }
    const id = nextId++;
    return new Promise<boolean>((resolve) => {
      resolvers.set(id, resolve);
      set((s) => ({ queue: [...s.queue, { id, req }] }));
    });
  },
  decide(id, approved) {
    resolvers.get(id)?.(approved);
    resolvers.delete(id);
    set((s) => ({ queue: s.queue.filter((q) => q.id !== id) }));
  },
  approveSession(id) {
    set({ sessionAutoApprove: true });
    get().decide(id, true);
  },
  setSessionAutoApprove(v) {
    set({ sessionAutoApprove: v });
  },
  cancelAll() {
    for (const resolve of resolvers.values()) resolve(false);
    resolvers.clear();
    set({ queue: [], sessionAutoApprove: false });
  },
}));
