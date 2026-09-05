import { create } from "zustand";
import {
  acpCatalog, acpEvents, acpSessions, acpSnapshot, onAcpEvent, onAcpResync,
  type AcpAgentStatus, type AcpEvent, type AcpPermission, type AcpSession, type AcpSnapshot,
} from "@/lib/acp";

interface AcpState {
  catalog: AcpAgentStatus[];
  sessions: Record<string, AcpSession>;
  activeByProject: Record<string, string | null>;
  events: Record<string, AcpEvent[]>;
  permissions: Record<string, AcpPermission[]>;
  refreshCatalog: (probe?: boolean) => Promise<void>;
  loadProject: (projectId: string) => Promise<void>;
  open: (projectId: string, id: string) => Promise<void>;
  loadEarlier: (projectId: string, id: string) => Promise<void>;
  resync: (projectId: string, id: string) => Promise<void>;
  setSnapshot: (snapshot: AcpSnapshot) => void;
  setActive: (projectId: string, id: string | null) => void;
  ingest: (events: AcpEvent[]) => void;
}

export function mergeAcpEvents(current: readonly AcpEvent[], incoming: readonly AcpEvent[]): AcpEvent[] {
  const bySequence = new Map(current.map((event) => [event.sequence, event]));
  for (const event of incoming) if (!bySequence.has(event.sequence)) bySequence.set(event.sequence, event);
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

export const useAcpSessionsStore = create<AcpState>((set, get) => ({
  catalog: [], sessions: {}, activeByProject: {}, events: {}, permissions: {},
  refreshCatalog: async (probe = false) => { set({ catalog: await acpCatalog(probe) }); },
  loadProject: async (projectId) => {
    const sessions = await acpSessions(projectId);
    set((state) => ({ sessions: { ...state.sessions, ...Object.fromEntries(sessions.map((session) => [session.id, session])) } }));
  },
  setSnapshot: (snapshot) => set((state) => (state.sessions[snapshot.session.id]?.lastSequence ?? -1) > snapshot.session.lastSequence ? state : ({
    sessions: { ...state.sessions, [snapshot.session.id]: snapshot.session },
    permissions: { ...state.permissions, [snapshot.session.id]: snapshot.permissions },
  })),
  setActive: (projectId, id) => set((state) => ({ activeByProject: { ...state.activeByProject, [projectId]: id } })),
  open: async (projectId, id) => {
    get().setActive(projectId, id);
    const snapshot = await acpSnapshot(projectId, id);
    get().setSnapshot(snapshot);
    const after = Math.max(0, snapshot.session.lastSequence - 300);
    const page = await acpEvents(projectId, id, after);
    set((state) => ({ events: { ...state.events, [id]: mergeAcpEvents(state.events[id] ?? [], page.events) } }));
  },
  loadEarlier: async (projectId, id) => {
    const first = get().events[id]?.[0]?.sequence ?? 1;
    if (first <= 1) return;
    const page = await acpEvents(projectId, id, Math.max(0, first - 301), Math.min(300, first - 1));
    set((state) => ({ events: { ...state.events, [id]: mergeAcpEvents(state.events[id] ?? [], page.events.filter((event) => event.sequence < first)) } }));
  },
  resync: async (projectId, id) => {
    const snapshot = await acpSnapshot(projectId, id);
    get().setSnapshot(snapshot);
    let after = get().events[id]?.at(-1)?.sequence ?? Math.max(0, snapshot.session.lastSequence - 300);
    for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
      const page = await acpEvents(projectId, id, after);
      get().ingest(page.events);
      after = page.events.at(-1)?.sequence ?? after;
      if (!page.hasMore) break;
    }
  },
  ingest: (incoming) => set((state) => {
    const events = { ...state.events };
    const sessions = { ...state.sessions };
    const permissions = { ...state.permissions };
    const grouped = new Map<string, AcpEvent[]>();
    for (const event of incoming) {
      const group = grouped.get(event.sessionId) ?? [];
      group.push(event);
      grouped.set(event.sessionId, group);
      const session = sessions[event.sessionId];
      if (session && event.sequence > session.lastSequence) {
        const status = event.kind === "user_message" ? "running"
          : event.kind === "turn_complete" ? event.data.stopReason === "cancelled" ? "cancelled" : event.data.error ? "failed" : "ready"
          : event.kind === "status" && typeof event.data.status === "string" ? event.data.status as AcpSession["status"] : session.status;
        sessions[event.sessionId] = { ...session, status, turnId: event.turnId, updatedAt: event.timestamp, lastSequence: event.sequence };
      }
      if (event.kind === "permission") {
        const permission = event.data as unknown as AcpPermission;
        const current = permissions[event.sessionId] ?? [];
        if (permission.expiresAt > Date.now() && !current.some((value) => value.id === permission.id)) permissions[event.sessionId] = [...current, permission];
      } else if (event.kind === "permission_resolved") {
        permissions[event.sessionId] = (permissions[event.sessionId] ?? []).filter((value) => value.id !== event.data.id);
      } else if (event.kind === "turn_complete" || (event.kind === "status" && event.data.status !== "running" && event.data.status !== "ready")) {
        permissions[event.sessionId] = [];
      }
    }
    for (const [id, group] of grouped) events[id] = mergeAcpEvents(events[id] ?? [], group);
    return { events, sessions, permissions };
  }),
}));

let listenerCount = 0;
let stopListeners: (() => void) | undefined;
let listenerPromise: Promise<void> | undefined;
let queued: AcpEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

export async function attachAcpListeners(): Promise<() => void> {
  listenerCount++;
  if (!listenerPromise) {
    listenerPromise = (async () => {
      const stopEvent = await onAcpEvent((event) => {
        queued.push(event);
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
          const batch = queued; queued = []; flushTimer = undefined;
          useAcpSessionsStore.getState().ingest(batch);
          for (const event of batch) if (event.kind === "controls" || event.kind === "status" || event.kind === "turn_complete") {
            void acpSnapshot(event.projectId, event.sessionId).then(useAcpSessionsStore.getState().setSnapshot).catch(() => {});
          }
        }, 32);
      });
      const stopResync = await onAcpResync(() => {
        const state = useAcpSessionsStore.getState();
        for (const [project, id] of Object.entries(state.activeByProject)) if (id) void state.resync(project, id).catch(() => {});
      });
      stopListeners = () => { stopEvent(); stopResync(); };
    })().catch((error: unknown) => { listenerPromise = undefined; throw error; });
  }
  try { await listenerPromise; } catch (error) { listenerCount--; throw error; }
  return () => {
    listenerCount--;
    if (listenerCount === 0) { stopListeners?.(); stopListeners = undefined; listenerPromise = undefined; if (flushTimer) clearTimeout(flushTimer); flushTimer = undefined; queued = []; }
  };
}
