import { create } from "zustand";
import type { CollabProjectRole } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";

export const ACTIVITY_CAP = 200;
const STORAGE_PREFIX = "oleafly.collab.activity.";

export type NewActivity =
  | { kind: "welcome"; at: number; owner: string; server: string; role: CollabProjectRole }
  | { kind: "joined" | "left"; at: number; accountId: string; name: string }
  | { kind: "offline"; at: number; pending: number }
  | { kind: "online"; at: number }
  | {
      kind: "merged";
      at: number;
      files: MergedFileCount[];
      authors?: { accountId: string; files: MergedFileCount[] }[];
      review?: { before: string; after: string };
    }
  | { kind: "newDevice"; at: number; accountId: string; name: string }
  | {
      kind: "renamed";
      at: number;
      accountId: string | null;
      name: string;
      before: string;
      ours: string;
      theirs: string;
    }
  | {
      kind: "mentioned";
      at: number;
      accountId: string;
      name: string;
      path: string | null;
      threadId: string;
      messageId: string;
    }
  | { kind: "role"; at: number; role: CollabProjectRole }
  | { kind: "removed"; at: number; by?: string }
  | { kind: "archived"; at: number }
  | { kind: "signedOut" | "suspended"; at: number; server: string }
  | { kind: "accessEnded"; at: number; server: string; guest: boolean }
  | {
      kind: "memberAdded" | "memberRemoved";
      at: number;
      accountId: string;
      byAccountId: string;
      name: string;
      by: string;
      byYou: boolean;
    };

export type ActivityEntry = NewActivity & { id: string; count: number };

export interface MergedFileCount {
  path: string;
  changes: number;
}

interface ActivityState {
  projectId: string | null;
  entries: ActivityEntry[];
  unread: boolean;
  open: (projectId: string | null) => void;
  add: (entry: NewActivity) => void;
  setPending: (pending: number) => void;
  markRead: () => void;
}

export function activityKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

function connection(entry: NewActivity | undefined): boolean {
  return entry?.kind === "offline" || entry?.kind === "online";
}

function presence(entry: NewActivity | undefined): string | null {
  return entry?.kind === "joined" || entry?.kind === "left" ? entry.accountId : null;
}

function foldsInto(previous: ActivityEntry | undefined, next: NewActivity): boolean {
  if (connection(previous) && connection(next)) return true;
  const person = presence(next);
  return person !== null && presence(previous) === person;
}

export function pushActivity(entries: readonly ActivityEntry[], next: NewActivity): ActivityEntry[] {
  const [newest, ...rest] = entries;
  if (newest && foldsInto(newest, next)) {
    return [{ ...next, id: newest.id, count: newest.count + 1 }, ...rest];
  }
  return [{ ...next, id: crypto.randomUUID(), count: 1 }, ...entries].slice(0, ACTIVITY_CAP);
}

function paneOpen(): boolean {
  const settings = useSettingsStore.getState();
  return settings.railTab === "collab" && settings.showTree;
}

function load(projectId: string): { entries: ActivityEntry[]; unread: boolean } {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(activityKey(projectId)) ?? "null");
    if (!parsed || typeof parsed !== "object") return { entries: [], unread: false };
    const record = parsed as { entries?: unknown; unread?: unknown };
    const entries = Array.isArray(record.entries) ? (record.entries as ActivityEntry[]).slice(0, ACTIVITY_CAP) : [];
    return { entries, unread: record.unread === true };
  } catch {
    return { entries: [], unread: false };
  }
}

function save(projectId: string | null, entries: readonly ActivityEntry[], unread: boolean): void {
  if (!projectId) return;
  try {
    localStorage.setItem(activityKey(projectId), JSON.stringify({ entries, unread }));
  } catch {
    return;
  }
}

export const useCollabActivity = create<ActivityState>((set, get) => ({
  projectId: null,
  entries: [],
  unread: false,
  open: (projectId) => {
    if (get().projectId === projectId) return;
    set(projectId ? { projectId, ...load(projectId) } : { projectId: null, entries: [], unread: false });
  },
  add: (entry) => {
    const { projectId, entries } = get();
    if (!projectId) return;
    const next = pushActivity(entries, entry);
    const unread = get().unread || !paneOpen();
    set({ entries: next, unread });
    save(projectId, next, unread);
  },
  setPending: (pending) => {
    const { projectId, entries, unread } = get();
    const [newest, ...rest] = entries;
    if (newest?.kind !== "offline" || newest.pending === pending) return;
    const next = [{ ...newest, pending }, ...rest];
    set({ entries: next });
    save(projectId, next, unread);
  },
  markRead: () => {
    const { projectId, entries, unread } = get();
    if (!unread) return;
    set({ unread: false });
    save(projectId, entries, false);
  },
}));
