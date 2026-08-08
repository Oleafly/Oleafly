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

const OMITTED_ARGUMENT_KEYS = /(?:content|code|source|data|image|base64|bytes|replace)/i;
const MAX_ARGUMENT_KEYS = 16;
const MAX_ARGUMENT_VALUE_CHARS = 160;

export function sanitizeMcpArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const entries = Object.entries(args ?? {}).slice(0, MAX_ARGUMENT_KEYS);
  for (const [key, value] of entries) {
    if (typeof value === "string") {
      sanitized[key] = /^\[omitted \d+ chars\]$/.test(value)
        ? value
        : OMITTED_ARGUMENT_KEYS.test(key)
        ? `[omitted ${value.length} chars]`
        : value.length > MAX_ARGUMENT_VALUE_CHARS
          ? `${value.slice(0, MAX_ARGUMENT_VALUE_CHARS - 1)}…`
          : value;
    } else if (typeof value === "number" || typeof value === "boolean" || value == null) {
      sanitized[key] = value;
    } else if (Array.isArray(value)) {
      sanitized[key] = `[${value.length} items]`;
    } else {
      sanitized[key] = "[object]";
    }
  }
  if (Object.keys(args ?? {}).length > entries.length) {
    sanitized._truncated = true;
  }
  return sanitized;
}

export function formatMcpArgs(args: Record<string, unknown>): string {
  return summarizeArgs(sanitizeMcpArgs(args));
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
      args: sanitizeMcpArgs(args),
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
      if (!s.logs.some((e) => e.id === id && e.status === "running")) return s;
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
