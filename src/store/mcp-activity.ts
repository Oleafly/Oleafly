import { create } from "zustand";

export interface McpLogEntry {
  id: number;
  ts: number;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "error";
  durationMs?: number;
  summary?: string;
}

const MAX_LOGS = 200;
let nextId = 1;

interface McpActivityState {
  serverRunning: boolean;
  logs: McpLogEntry[];
  unread: number;
  setServerRunning: (v: boolean) => void;
  beginCall: (name: string, args: Record<string, unknown>) => number;
  endCall: (id: number, result: { ok: boolean; summary?: string }) => void;
  clearLogs: () => void;
  clearUnread: () => void;
}

function summarizeArgs(args: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(args);
    if (s === "{}" || s === "null") return "";
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  } catch {
    return "";
  }
}

export function formatMcpArgs(args: Record<string, unknown>): string {
  return summarizeArgs(args);
}

export const useMcpActivityStore = create<McpActivityState>((set) => ({
  serverRunning: false,
  logs: [],
  unread: 0,
  setServerRunning: (v) => set({ serverRunning: v }),
  beginCall: (name, args) => {
    const id = nextId++;
    const entry: McpLogEntry = {
      id,
      ts: Date.now(),
      name,
      args: args ?? {},
      status: "running",
    };
    set((s) => ({
      logs: [entry, ...s.logs].slice(0, MAX_LOGS),
    }));
    return id;
  },
  endCall: (id, result) => {
    const now = Date.now();
    set((s) => {
      // Only count an unread completion when the entry is still present. It may
      // have been evicted by the MAX_LOGS cap, or endCall may fire twice for one
      // id; bumping unread regardless would drift the badge above the visible
      // completed calls.
      if (!s.logs.some((e) => e.id === id)) return s;
      return {
        unread: s.unread + 1,
        logs: s.logs.map((e) =>
          e.id === id
            ? {
                ...e,
                status: result.ok ? "ok" : "error",
                durationMs: Math.max(0, now - e.ts),
                summary: result.summary,
              }
            : e,
        ),
      };
    });
  },
  clearLogs: () => set({ logs: [], unread: 0 }),
  clearUnread: () => set({ unread: 0 }),
}));

export function summarizeMcpResult(raw: unknown, isError?: boolean): string {
  if (raw == null) return isError ? "error" : "ok";
  if (typeof raw === "string") {
    return raw.length > 160 ? `${raw.slice(0, 157)}…` : raw;
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.error === "string") return o.error;
    try {
      const s = JSON.stringify(raw);
      return s.length > 160 ? `${s.slice(0, 157)}…` : s;
    } catch {
      return isError ? "error" : "ok";
    }
  }
  return String(raw);
}
