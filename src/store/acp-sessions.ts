import { useRef } from "react";
import { create } from "zustand";
import type { DraftAttachment } from "@/components/ai/composer/types";
import { refreshOpenFilesFromDisk } from "@/lib/external-file-changes";
import { registerAttachmentHolder, useComposerDrafts } from "@/store/composer-drafts";
import {
  acpBufferReply, acpCatalog, acpDisconnect, acpError, acpEvents, acpPrompt, acpPromptDelivered, acpSessions,
  acpSnapshot, acpStart, acpSteer, onAcpBufferRequest, onAcpEvent, onAcpResync, onAcpSession,
  type AcpAgentStatus, type AcpBufferRequest, type AcpCommand, type AcpElicitation, type AcpEvent, type AcpPermission,
  type AcpSession, type AcpSessionSummary, type AcpSessionUsage, type AcpSnapshot, type AcpTurnCommit,
} from "@/lib/acp";

/** A skill sent with the next message; shown as a removable chip. */
export interface AcpComposerSkill { id: string; name: string }
/** Quoted editor text sent with the next message. */
export interface AcpSelection { id: string; path: string | null; text: string; label: string }
/** What the CLI composer keeps besides its text and files (B's drafts store has those). */
export interface AcpComposer { agentId: string | null; skill?: AcpComposerSkill | null; selections?: AcpSelection[] }
export interface AcpQueuedPrompt {
  id: string;
  text: string;
  attachments: DraftAttachment[];
  mentions: string[];
  selections: AcpSelection[];
  skill: AcpComposerSkill | null;
  sending?: boolean;
  failed?: boolean;
}
export type AcpPromptDraft = Omit<AcpQueuedPrompt, "id" | "sending" | "failed">;

export const EMPTY_COMPOSER: AcpComposer = { agentId: null };
/** Transcript events kept in memory for a shown conversation. */
export const MAX_VISIBLE_EVENTS = 2000;
/** What a conversation may keep after the reader loaded earlier events: those must not vanish under them. */
const MAX_PINNED_EVENTS = 3 * MAX_VISIBLE_EVENTS;
/**
 * A live transcript may run this far past the cap before its head is cut.
 * Every cut changes the first event, which makes the projector start over, so
 * cutting on every batch would rebuild every row about thirty times a second.
 */
const TRIM_SLACK = 250;

/**
 * The composer id of a CLI agent in a project. A conversation has its own
 * draft; before one starts, the draft belongs to the agent chosen to start it.
 */
export function acpComposerId(projectId: string, agentId: string | null, sessionId: string | null = null): string {
  const base = `${projectId}:acp:${agentId ?? "none"}`;
  return sessionId ? `${base}:${sessionId}` : base;
}

interface AcpState {
  catalog: AcpAgentStatus[];
  sessions: Record<string, AcpSession>;
  activeByProject: Record<string, string | null>;
  events: Record<string, AcpEvent[]>;
  permissions: Record<string, AcpPermission[]>;
  elicitations: Record<string, AcpElicitation[]>;
  composers: Record<string, AcpComposer>;
  queues: Record<string, AcpQueuedPrompt[]>;
  /** Conversations shown somewhere other than the active slot (a task opened elsewhere). */
  watched: Record<string, number>;
  /** Messages on their way to the agent, per conversation. */
  sending: Record<string, number>;
  /** Earlier events the user loaded into a shown conversation; live events do not trim them away (up to a larger cap). */
  earlierLoaded: Record<string, number>;
  errors: Record<string, string | null>;
  setError: (projectId: string, message: string | null) => void;
  /** Why a message of one conversation did not go out; shown only with that conversation. */
  sessionErrors: Record<string, string | null>;
  setSessionError: (sessionId: string, message: string | null) => void;
  /** Returns true only when this request supplied the accepted catalog. */
  refreshCatalog: (probe?: boolean) => Promise<boolean>;
  loadProject: (projectId: string) => Promise<void>;
  open: (projectId: string, id: string) => Promise<void>;
  start: (projectId: string, agentId: string) => Promise<void>;
  starting: Record<string, boolean>;
  loadEarlier: (projectId: string, id: string) => Promise<void>;
  resync: (projectId: string, id: string) => Promise<void>;
  setSnapshot: (snapshot: AcpSnapshot) => void;
  setActive: (projectId: string, id: string | null) => void;
  setComposer: (projectId: string, patch: Partial<AcpComposer>) => void;
  ingest: (events: AcpEvent[]) => void;
  watch: (sessionId: string) => () => void;
  enqueue: (sessionId: string, draft: AcpPromptDraft) => string;
  removeQueued: (sessionId: string, id: string) => void;
  /** Sends a message that failed once more. */
  retryQueued: (projectId: string, sessionId: string, id: string) => Promise<void>;
  /** Drops everything the store holds for a deleted conversation. */
  forgetSession: (projectId: string, sessionId: string) => void;
  /** False when the message was not sent (the conversation's error says why). */
  sendPrompt: (projectId: string, sessionId: string, draft: AcpPromptDraft) => Promise<boolean>;
  startWithPrompt: (projectId: string, agentId: string, draft: AcpPromptDraft) => Promise<void>;
  dispatchQueued: (projectId: string, sessionId: string) => Promise<void>;
  steerQueued: (projectId: string, sessionId: string, id: string) => Promise<void>;
  applySummary: (summary: AcpSessionSummary) => void;
  /** Disconnects the project's idle conversations when the window leaves the project; a working one keeps going. */
  releaseProject: (projectId: string) => Promise<void>;
}

export function isDelegatedSession(session: AcpSession): boolean {
  return !!session.taskId || !!session.parentSessionId;
}

function appendsInOrder(current: readonly AcpEvent[], incoming: readonly AcpEvent[]): boolean {
  let last = current.at(-1)?.sequence ?? Number.NEGATIVE_INFINITY;
  for (const event of incoming) {
    if (event.sequence <= last) return false;
    last = event.sequence;
  }
  return true;
}

export function mergeAcpEvents(
  current: readonly AcpEvent[],
  incoming: readonly AcpEvent[],
  cap: number = MAX_VISIBLE_EVENTS,
): AcpEvent[] {
  const merged = appendsInOrder(current, incoming)
    ? [...current, ...incoming]
    : (() => {
        const bySequence = new Map(current.map((event) => [event.sequence, event]));
        for (const event of incoming) if (!bySequence.has(event.sequence)) bySequence.set(event.sequence, event);
        return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
      })();
  return merged.length > cap + TRIM_SLACK ? merged.slice(merged.length - cap) : merged;
}

/** The events of a conversation that is no longer kept in memory. */
function withoutEvents(
  state: Pick<AcpState, "events" | "earlierLoaded">,
  sessionId: string,
): Pick<AcpState, "events" | "earlierLoaded"> {
  const { [sessionId]: _events, ...events } = state.events;
  const { [sessionId]: _earlier, ...earlierLoaded } = state.earlierLoaded;
  return { events, earlierLoaded };
}

function turnCommitFrom({ data, timestamp }: AcpEvent): AcpTurnCommit {
  return {
    turnId: typeof data.turnId === "string" ? data.turnId : "",
    commit: typeof data.commit === "string" ? data.commit : "",
    paths: Array.isArray(data.paths) ? (data.paths as string[]) : [],
    message: "",
    createdAt: timestamp,
  };
}

/** Fields an event changes on its session without a snapshot round trip. */
function applySessionEvent(sessions: Record<string, AcpSession>, event: AcpEvent): void {
  const session = sessions[event.sessionId];
  if (!session || event.sequence <= session.lastSequence) return;
  const next: AcpSession = {
    ...session,
    status: statusForEvent(event, session.status),
    turnId: event.turnId,
    updatedAt: event.timestamp,
    lastSequence: event.sequence,
  };
  const data = event.data;
  switch (event.kind) {
    case "usage":
      if (data.session && typeof data.session === "object") {
        // The plan text comes from a slower refresh and is not on every event.
        const incoming = data.session as AcpSessionUsage;
        next.usage = {
          ...incoming,
          planMarkdown: incoming.planMarkdown ?? session.usage?.planMarkdown,
          planMarkdownAt: incoming.planMarkdownAt ?? session.usage?.planMarkdownAt,
        };
      }
      break;
    case "available_commands":
      if (Array.isArray(data.commands)) next.availableCommands = data.commands as AcpCommand[];
      break;
    case "session_info":
      if (typeof data.title === "string" && !session.titleLocked) next.title = data.title;
      break;
    case "controls":
      if (data.controls && typeof data.controls === "object" && !Array.isArray(data.controls)) {
        next.controls = { ...session.controls, ...(data.controls as AcpSession["controls"]) };
      }
      break;
    case "turn_commit":
      next.commits = [...(session.commits ?? []), turnCommitFrom(event)];
      break;
  }
  sessions[event.sessionId] = next;
}

function clearsPermissions(event: AcpEvent): boolean {
  if (event.kind === "turn_complete") return true;
  return event.kind === "status" && event.data.status !== "running" && event.data.status !== "ready";
}

function nextPermissions(current: AcpPermission[], event: AcpEvent): AcpPermission[] {
  if (event.kind === "permission") {
    const permission = event.data as unknown as AcpPermission;
    if (permission.expiresAt <= Date.now() || current.some((value) => value.id === permission.id)) return current;
    return [...current, permission];
  }
  if (event.kind === "permission_resolved") return current.filter((value) => value.id !== event.data.id);
  return clearsPermissions(event) ? [] : current;
}

function applyPermissionEvent(
  permissions: Record<string, AcpPermission[]>,
  event: AcpEvent,
): Record<string, AcpPermission[]> {
  const current = permissions[event.sessionId] ?? [];
  const next = nextPermissions(current, event);
  return next === current ? permissions : { ...permissions, [event.sessionId]: next };
}

function nextElicitations(current: AcpElicitation[], event: AcpEvent): AcpElicitation[] {
  if (event.kind === "elicitation") {
    const request = event.data as unknown as AcpElicitation;
    if (request.expiresAt <= Date.now() || current.some((value) => value.id === request.id)) return current;
    return [...current, request];
  }
  if (event.kind === "elicitation_resolved") return current.filter((value) => value.id !== event.data.id);
  if (event.kind === "status" && (event.data.status === "disconnected" || event.data.status === "failed")) return [];
  return current;
}

function applyElicitationEvent(
  elicitations: Record<string, AcpElicitation[]>,
  event: AcpEvent,
): Record<string, AcpElicitation[]> {
  const current = elicitations[event.sessionId] ?? [];
  const next = nextElicitations(current, event);
  return next === current ? elicitations : { ...elicitations, [event.sessionId]: next };
}

const VOLATILE_SESSION_FIELDS: ReadonlySet<string> = new Set(["updatedAt", "lastSequence", "turnId"]);

export function sameSessionView(shown: AcpSession | undefined, next: AcpSession | undefined): boolean {
  if (shown === next) return true;
  if (!shown || !next) return false;
  const keys = new Set([...Object.keys(shown), ...Object.keys(next)]);
  for (const key of keys) {
    if (VOLATILE_SESSION_FIELDS.has(key)) continue;
    if (shown[key as keyof AcpSession] !== next[key as keyof AcpSession]) return false;
  }
  return true;
}

const QUEUE_FLUSHES_ITSELF: ReadonlySet<string> = new Set(["ready", "connecting", "running", "cancelling"]);

/**
 * A conversation the user leaves while it cannot take messages (signed out,
 * disconnected) keeps its queue, which would send whenever it turns ready
 * again, maybe hours later. Those messages are marked as not sent instead.
 */
function leftQueue(
  state: Pick<AcpState, "queues" | "sessions">,
  sessionId: string,
): Partial<Pick<AcpState, "queues">> {
  const queue = state.queues[sessionId];
  if (!queue?.some((item) => !item.failed && !item.sending)) return {};
  if (QUEUE_FLUSHES_ITSELF.has(state.sessions[sessionId]?.status ?? "")) return {};
  return {
    queues: {
      ...state.queues,
      [sessionId]: queue.map((item) => (item.failed || item.sending ? item : { ...item, failed: true })),
    },
  };
}

/** Conversations whose transcript is kept in memory. */
function visibleIds(state: Pick<AcpState, "activeByProject" | "watched">): Set<string> {
  const ids = new Set<string>();
  for (const id of Object.values(state.activeByProject)) if (id) ids.add(id);
  for (const [id, count] of Object.entries(state.watched)) if (count > 0) ids.add(id);
  return ids;
}

let catalogRequest = 0;
let queueCounter = 0;

function sentUserMessage(before: number, sessionId: string): boolean {
  const events = useAcpSessionsStore.getState().events[sessionId] ?? [];
  return events.some((event) => event.sequence > before && event.kind === "user_message");
}

export const useAcpSessionsStore = create<AcpState>((set, get) => ({
  catalog: [], sessions: {}, activeByProject: {}, events: {}, permissions: {}, elicitations: {}, composers: {},
  queues: {}, watched: {}, sending: {}, earlierLoaded: {}, errors: {}, sessionErrors: {}, starting: {},
  setError: (projectId, message) => set((state) => state.errors[projectId] === message ? state : ({ errors: { ...state.errors, [projectId]: message } })),
  setSessionError: (sessionId, message) => set((state) => (state.sessionErrors[sessionId] ?? null) === message
    ? state
    : ({ sessionErrors: { ...state.sessionErrors, [sessionId]: message } })),
  refreshCatalog: async (probe = false) => {
    const request = ++catalogRequest;
    try {
      const catalog = await acpCatalog(probe);
      if (request !== catalogRequest) return false;
      set({ catalog });
      return true;
    } catch (error) {
      if (request === catalogRequest) throw error;
      return false;
    }
  },
  loadProject: async (projectId) => {
    const sessions = await acpSessions(projectId);
    set((state) => ({ sessions: { ...state.sessions, ...Object.fromEntries(sessions.filter((session) => (state.sessions[session.id]?.lastSequence ?? -1) <= session.lastSequence).map((session) => [session.id, session])) } }));
  },
  setSnapshot: (snapshot) => set((state) => (state.sessions[snapshot.session.id]?.lastSequence ?? -1) > snapshot.session.lastSequence ? state : ({
    sessions: { ...state.sessions, [snapshot.session.id]: snapshot.session },
    permissions: { ...state.permissions, [snapshot.session.id]: snapshot.permissions },
    elicitations: { ...state.elicitations, [snapshot.session.id]: snapshot.elicitations ?? [] },
  })),
  setActive: (projectId, id) => set((state) => {
    const previous = state.activeByProject[projectId];
    const activeByProject = { ...state.activeByProject, [projectId]: id };
    if (!previous || previous === id) return { activeByProject };
    if (visibleIds({ activeByProject, watched: state.watched }).has(previous)) return { activeByProject };
    return { activeByProject, ...withoutEvents(state, previous), ...leftQueue(state, previous) };
  }),
  setComposer: (projectId, patch) => set((state) => ({ composers: { ...state.composers, [projectId]: { ...EMPTY_COMPOSER, ...state.composers[projectId], ...patch } } })),
  start: async (projectId, agentId) => {
    set((state) => ({ starting: { ...state.starting, [projectId]: true } }));
    try {
      const openId = get().activeByProject[projectId];
      const open = openId ? get().sessions[openId] : undefined;
      if (openId && open && ["ready", "auth_required"].includes(open.status)) {
        await acpDisconnect(projectId, openId);
      }
      const snapshot = await acpStart(projectId, agentId);
      get().setSnapshot(snapshot);
      const id = snapshot.session.id;
      get().setActive(projectId, id);
      // What the agent sent while it started came before the conversation
      // was shown, so it wasn't kept; load it as an opened conversation does.
      // Missing, the first event looked like earlier activity to load.
      try {
        const page = await acpEvents(projectId, id, Math.max(0, snapshot.session.lastSequence - 300));
        set((state) => ({ events: { ...state.events, [id]: mergeAcpEvents(state.events[id] ?? [], page.events) } }));
      } catch {
        // Live events still arrive; only the ones from the start stay missing.
      }
    } finally {
      set((state) => ({ starting: { ...state.starting, [projectId]: false } }));
    }
  },
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
    set((state) => {
      const earlier = page.events.filter((event) => event.sequence < first);
      const all = [...earlier, ...(state.events[id] ?? [])];
      // Loading earlier history may go past the in-memory cap, and the next
      // live batch must not trim away what the reader just asked for.
      return {
        events: { ...state.events, [id]: all },
        earlierLoaded: { ...state.earlierLoaded, [id]: (state.earlierLoaded[id] ?? 0) + earlier.length },
      };
    });
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
    const visible = visibleIds(state);
    const events = { ...state.events };
    const sessions = { ...state.sessions };
    let permissions = state.permissions;
    let elicitations = state.elicitations;
    const grouped = new Map<string, AcpEvent[]>();
    for (const event of incoming) {
      applySessionEvent(sessions, event);
      permissions = applyPermissionEvent(permissions, event);
      elicitations = applyElicitationEvent(elicitations, event);
      if (!visible.has(event.sessionId)) continue;
      const group = grouped.get(event.sessionId) ?? [];
      group.push(event);
      grouped.set(event.sessionId, group);
    }
    for (const [id, group] of grouped) {
      const pinned = (state.earlierLoaded[id] ?? 0) > 0;
      events[id] = mergeAcpEvents(events[id] ?? [], group, pinned ? MAX_PINNED_EVENTS : MAX_VISIBLE_EVENTS);
    }
    return { events, sessions, permissions, elicitations };
  }),
  watch: (sessionId) => {
    set((state) => ({ watched: { ...state.watched, [sessionId]: (state.watched[sessionId] ?? 0) + 1 } }));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      set((state) => {
        const count = (state.watched[sessionId] ?? 1) - 1;
        const watched = { ...state.watched };
        if (count > 0) watched[sessionId] = count;
        else delete watched[sessionId];
        if (visibleIds({ activeByProject: state.activeByProject, watched }).has(sessionId)) return { watched };
        return { watched, ...withoutEvents(state, sessionId), ...leftQueue(state, sessionId) };
      });
    };
  },
  enqueue: (sessionId, draft) => {
    const id = `queued-${Date.now()}-${++queueCounter}`;
    set((state) => ({ queues: { ...state.queues, [sessionId]: [...(state.queues[sessionId] ?? []), { ...draft, id }] } }));
    return id;
  },
  removeQueued: (sessionId, id) => set((state) => {
    const queue = state.queues[sessionId] ?? [];
    const next = queue.filter((item) => item.id !== id);
    return next.length === queue.length ? state : { queues: { ...state.queues, [sessionId]: next } };
  }),
  retryQueued: async (projectId, sessionId, id) => {
    set((state) => ({
      queues: {
        ...state.queues,
        [sessionId]: (state.queues[sessionId] ?? []).map((item) => (item.id === id ? { ...item, failed: false } : item)),
      },
    }));
    get().setSessionError(sessionId, null);
    await get().dispatchQueued(projectId, sessionId);
  },
  forgetSession: (projectId, sessionId) => {
    const session = get().sessions[sessionId];
    set((state) => {
      const drop = <T,>(record: Record<string, T>): Record<string, T> => {
        const { [sessionId]: _gone, ...rest } = record;
        return rest;
      };
      return {
        sessions: drop(state.sessions),
        permissions: drop(state.permissions),
        elicitations: drop(state.elicitations),
        queues: drop(state.queues),
        sending: drop(state.sending),
        watched: drop(state.watched),
        sessionErrors: drop(state.sessionErrors),
        ...withoutEvents(state, sessionId),
        activeByProject: state.activeByProject[projectId] === sessionId
          ? { ...state.activeByProject, [projectId]: null }
          : state.activeByProject,
      };
    });
    // The conversation's draft goes with it, so its files can be collected.
    const composerId = acpComposerId(projectId, session?.agentId ?? null, sessionId);
    const drafts = useComposerDrafts.getState();
    drafts.setText(composerId, "");
    drafts.setAttachments(composerId, []);
  },
  sendPrompt: async (projectId, sessionId, draft) => {
    const adjust = (delta: number) => set((state) => {
      const count = Math.max(0, (state.sending[sessionId] ?? 0) + delta);
      const sending = { ...state.sending };
      if (count > 0) sending[sessionId] = count;
      else delete sending[sessionId];
      return { sending };
    });
    // Counted while the open files save too, so the composer queues the
    // next message instead of starting a second turn.
    adjust(1);
    try {
      const [{ flushOpenFilesToDisk }, { SaveFlushError }] = await Promise.all([
        import("@/lib/external-file-changes"),
        import("@/store/save-flush-error"),
      ]);
      try {
        await flushOpenFilesToDisk(projectId, "save before agent prompt");
      } catch (error) {
        if (error instanceof SaveFlushError) return false;
        throw error;
      }
      const session = get().sessions[sessionId];
      if (!session) return false;
      const before = session.lastSequence;
      try {
        const [{ toPromptInput }, { useFilesStore }] = await Promise.all([
          import("@/components/ai/acp/acp-attachments"),
          import("@/store/files"),
        ]);
        // A queued message can go while the window shows another project; its
        // mentions were then read from the conversation's project when it was queued.
        const files = useFilesStore.getState();
        const input = await toPromptInput(draft, session, files.projectId === projectId ? files.tree : null);
        get().setSnapshot(await acpPrompt(projectId, sessionId, input));
        get().setSessionError(sessionId, null);
        if (get().activeByProject[projectId] === sessionId) get().setError(projectId, null);
        return true;
      } catch (error) {
        await get().resync(projectId, sessionId).catch(() => {});
        const status = get().sessions[sessionId]?.status;
        if (status !== "auth_required") {
          const { promptErrorMessage } = await import("@/components/ai/acp/acp-attachments");
          get().setSessionError(sessionId, promptErrorMessage(error) ?? acpError(error));
        }
        // The backend says whether the agent got the message before the turn
        // failed; an older build only says why, and the transcript tells.
        return acpPromptDelivered(error) ?? sentUserMessage(before, sessionId);
      }
    } finally {
      adjust(-1);
      // A message queued while this one was on its way waits for a turn to
      // end; when this one never reached the agent, no turn will.
      if (!get().sending[sessionId]) void get().dispatchQueued(projectId, sessionId);
    }
  },
  startWithPrompt: async (projectId, agentId, draft) => {
    await get().start(projectId, agentId);
    const id = get().activeByProject[projectId];
    if (!id) return;
    get().enqueue(id, draft);
    if (get().sessions[id]?.status === "ready") await get().dispatchQueued(projectId, id);
  },
  dispatchQueued: async (projectId, sessionId) => {
    const head = get().queues[sessionId]?.[0];
    if (!head || head.sending || head.failed) return;
    if (get().sessions[sessionId]?.status !== "ready") return;
    const mark = (patch: Partial<AcpQueuedPrompt>) => set((state) => ({
      queues: { ...state.queues, [sessionId]: (state.queues[sessionId] ?? []).map((item) => item.id === head.id ? { ...item, ...patch } : item) },
    }));
    mark({ sending: true });
    const { id: _id, sending: _sending, failed: _failed, ...draft } = head;
    const sent = await get().sendPrompt(projectId, sessionId, draft);
    if (sent) {
      get().removeQueued(sessionId, head.id);
      // The turn can end before the prompt call returns; the next message
      // then has no later event to wait for.
      await get().dispatchQueued(projectId, sessionId);
    } else {
      mark({ sending: false, failed: true });
    }
  },
  steerQueued: async (projectId, sessionId, id) => {
    const item = get().queues[sessionId]?.find((entry) => entry.id === id);
    const session = get().sessions[sessionId];
    if (!item || item.sending || item.failed || session?.status !== "running" || !session.capabilities.steering) return;
    if (item.attachments.length > 0 || item.selections.length > 0 || item.skill) return;
    // On its way while the agent decides: a turn that ends meanwhile must not send it again.
    const mark = (sending: boolean) => set((state) => ({
      queues: { ...state.queues, [sessionId]: (state.queues[sessionId] ?? []).map((entry) => entry.id === id ? { ...entry, sending } : entry) },
    }));
    mark(true);
    try {
      const outcome = await acpSteer(projectId, sessionId, item.text);
      if (outcome === "injected") {
        get().removeQueued(sessionId, id);
      } else {
        // The turn ended first: the message goes out as a turn of its own as
        // soon as the conversation is ready.
        mark(false);
        await get().resync(projectId, sessionId).catch(() => {});
        await get().dispatchQueued(projectId, sessionId);
      }
    } catch (error) {
      mark(false);
      get().setSessionError(sessionId, acpError(error));
      void get().dispatchQueued(projectId, sessionId);
    }
  },
  applySummary: (summary) => set((state) => {
    const session = state.sessions[summary.sessionId];
    if (!session || summary.lastSequence <= session.lastSequence) return state;
    return {
      sessions: {
        ...state.sessions,
        [summary.sessionId]: {
          ...session,
          title: session.titleLocked ? session.title : summary.title,
          status: summary.status,
          updatedAt: summary.updatedAt,
          lastSequence: summary.lastSequence,
        },
      },
    };
  }),
  releaseProject: async (projectId) => {
    const state = get();
    const idle = Object.values(state.sessions).filter((session) =>
      session.projectId === projectId
      && !isDelegatedSession(session)
      && (session.status === "ready" || session.status === "auth_required")
      && !state.sending[session.id]
      && !state.queues[session.id]?.some((item) => !item.failed));
    // A conversation of another window is refused by the backend; that one stays as it is.
    await Promise.all(idle.map((session) => acpDisconnect(projectId, session.id).catch(() => {})));
  },
}));

registerAttachmentHolder(() => {
  const refs = new Set<string>();
  for (const queue of Object.values(useAcpSessionsStore.getState().queues)) {
    for (const prompt of queue) {
      for (const attachment of prompt.attachments) {
        if (attachment.sha256) refs.add(attachment.sha256);
        for (const page of attachment.pageImages ?? []) refs.add(page.sha256);
      }
    }
  }
  return refs;
});

export function useAcpSessionView(sessionId: string | null): AcpSession | undefined {
  const shown = useRef<AcpSession | undefined>(undefined);
  return useAcpSessionsStore((state) => {
    const next = sessionId ? state.sessions[sessionId] : undefined;
    if (sameSessionView(shown.current, next)) return shown.current;
    shown.current = next;
    return next;
  });
}

function mayHaveChangedFiles(event: AcpEvent): boolean {
  return event.kind === "turn_complete" || (event.kind === "tool_call_update" && event.data.status === "completed");
}

/** A batch event after which the next queued message may go. */
function endsTurn(event: AcpEvent): boolean {
  return event.kind === "turn_complete" || (event.kind === "status" && event.data.status === "ready");
}

let listenerCount = 0;
let stopListeners: (() => void) | undefined;
let listenerPromise: Promise<void> | undefined;
let queued: AcpEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
/** Set while nothing shows the agents but queued messages still wait for their turn to end. */
let stopWhenSent: (() => void) | undefined;

function statusForEvent(
  event: AcpEvent,
  current: AcpSession["status"],
): AcpSession["status"] {
  if (event.kind === "user_message" && event.data.steered !== true) return "running";
  if (event.kind === "turn_complete") return "ready";
  if (event.kind === "status" && typeof event.data.status === "string") {
    return event.data.status as AcpSession["status"];
  }
  return current;
}

/** Answers the agent's request for an open editor's text; with nothing when it cannot be read. */
async function answerBufferRequest({ requestId, projectId, path }: AcpBufferRequest): Promise<void> {
  try {
    const { bufferContent } = await import("@/components/ai/acp/acp-buffers");
    await acpBufferReply(requestId, bufferContent(projectId, path));
  } catch {
    await acpBufferReply(requestId, null).catch(() => {});
  }
}

function applyEventBatch(batch: AcpEvent[]): void {
  const store = useAcpSessionsStore.getState();
  store.ingest(batch);
  const refreshed = new Set<string>();
  for (const event of batch) if (event.kind === "status" || event.kind === "turn_complete") {
    if (refreshed.has(event.sessionId)) continue;
    refreshed.add(event.sessionId);
    void acpSnapshot(event.projectId, event.sessionId).then(useAcpSessionsStore.getState().setSnapshot).catch(() => {});
  }
  const ended = new Map<string, string>();
  for (const event of batch) if (endsTurn(event)) ended.set(event.sessionId, event.projectId);
  for (const [sessionId, projectId] of ended) {
    if (store.queues[sessionId]?.length) void useAcpSessionsStore.getState().dispatchQueued(projectId, sessionId);
  }
  for (const projectId of new Set(batch.filter(mayHaveChangedFiles).map((event) => event.projectId))) {
    refreshOpenFilesFromDisk(projectId);
  }
}

/** Applies the events waiting for the 32 ms batch now. */
function flushEventBatch(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  const batch = queued;
  queued = [];
  if (batch.length > 0) applyEventBatch(batch);
}

/** Queued messages that go out when a turn ends, which only these listeners see. */
function queueWaitsForTurn(state: Pick<AcpState, "queues" | "sessions">): boolean {
  return Object.entries(state.queues).some(([sessionId, queue]) =>
    QUEUE_FLUSHES_ITSELF.has(state.sessions[sessionId]?.status ?? "") && queue.some((item) => !item.failed));
}

function detachListeners(): void {
  stopWhenSent?.();
  stopWhenSent = undefined;
  // The last events still count: one of them may end the turn a queued message waits for.
  flushEventBatch();
  stopListeners?.();
  stopListeners = undefined;
  listenerPromise = undefined;
}

export async function attachAcpListeners(): Promise<() => void> {
  listenerCount++;
  stopWhenSent?.();
  stopWhenSent = undefined;
  listenerPromise ??= (async () => {
    // Collected as they register: when a later registration fails, the ones
    // already made must not stay behind to double every event.
    const stops: (() => void)[] = [];
    // One push per registration, once it has completed: a single push of all
    // four would lose the earlier ones when a later registration fails.
    const collectStop = async (registration: Promise<() => void>) => {
      stops.push(await registration);
    };
    try {
      await collectStop(onAcpEvent((event) => {
        queued.push(event);
        if (flushTimer) return;
        flushTimer = setTimeout(flushEventBatch, 32);
      }));
      await collectStop(onAcpResync(() => {
        const state = useAcpSessionsStore.getState();
        for (const [project, id] of Object.entries(state.activeByProject)) if (id) void state.resync(project, id).catch(() => {});
      }));
      // A summary is sent with each stored event: the event goes first, or the
      // summary's sequence would make the store skip what only the event carries.
      await collectStop(onAcpSession((summary) => {
        flushEventBatch();
        useAcpSessionsStore.getState().applySummary(summary);
      }));
      await collectStop(onAcpBufferRequest((request) => void answerBufferRequest(request)));
    } catch (error) {
      for (const stop of stops) stop();
      throw error;
    }
    // A session can turn ready without a turn ending (a reconnect after
    // signing in, a snapshot): a message that waited goes out then, too.
    stops.push(useAcpSessionsStore.subscribe((state, previous) => {
      for (const [sessionId, session] of Object.entries(state.sessions)) {
        if (session.status !== "ready" || previous.sessions[sessionId]?.status === "ready") continue;
        const head = state.queues[sessionId]?.[0];
        if (!head || head.sending || head.failed) continue;
        queueMicrotask(() => void useAcpSessionsStore.getState().dispatchQueued(session.projectId, sessionId));
      }
    }));
    stopListeners = () => { for (const stop of stops) stop(); };
  })().catch((error: unknown) => { listenerPromise = undefined; throw error; });
  try { await listenerPromise; } catch (error) { listenerCount--; throw error; }
  return () => {
    listenerCount--;
    if (listenerCount > 0) return;
    if (!queueWaitsForTurn(useAcpSessionsStore.getState())) {
      detachListeners();
      return;
    }
    // Nothing shows the agents now (the built-in assistant is open, or another
    // project), but a queued message still goes when its turn ends, not when
    // the user comes back.
    stopWhenSent ??= useAcpSessionsStore.subscribe((state) => {
      if (listenerCount === 0 && !queueWaitsForTurn(state)) detachListeners();
    });
  };
}
