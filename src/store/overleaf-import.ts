import { create } from "zustand";
import {
  DEFAULT_OVERLEAF_SERVER,
  isOverleafError,
  overleafImportProjects,
  overleafListProjects,
  overleafSignIn,
  overleafSignOut,
  overleafStatus,
  type OverleafImportEvent,
  type OverleafImportOutcome,
  type OverleafProject,
  type OverleafStatus,
} from "@/lib/overleaf";
import { logError } from "@/lib/log";

const SERVER_KEY = "oleafly.overleaf.server";

export type OverleafPhase = "idle" | "checking" | "signed-out" | "signing-in" | "loading" | "ready" | "error";

export type OverleafRowProgress =
  | { phase: "queued" }
  | { phase: "downloading"; received: number; total: number | null }
  | { phase: "importing" }
  | { phase: "done"; projectId: string }
  | { phase: "failed"; error: string };

interface OverleafImportState {
  server: string;
  status: OverleafStatus | null;
  projects: OverleafProject[];
  phase: OverleafPhase;
  error: unknown;
  selected: string[];
  progress: Record<string, OverleafRowProgress>;
  importing: boolean;
  setServer(server: string): void;
  refreshStatus(): Promise<void>;
  open(): Promise<void>;
  load(): Promise<void>;
  signIn(title: string): Promise<boolean>;
  signOut(): Promise<void>;
  toggle(id: string): void;
  setSelected(ids: readonly string[]): void;
  importSelected(ids?: readonly string[]): Promise<OverleafImportOutcome[]>;
}

function readServer(): string {
  try {
    return globalThis.localStorage?.getItem(SERVER_KEY)?.trim() || DEFAULT_OVERLEAF_SERVER;
  } catch {
    return DEFAULT_OVERLEAF_SERVER;
  }
}

function writeServer(server: string): void {
  try {
    if (server === DEFAULT_OVERLEAF_SERVER) globalThis.localStorage?.removeItem(SERVER_KEY);
    else globalThis.localStorage?.setItem(SERVER_KEY, server);
  } catch {
    return;
  }
}

function progressFor(event: OverleafImportEvent): OverleafRowProgress {
  switch (event.phase) {
    case "downloading":
      return { phase: "downloading", received: event.received, total: event.total };
    case "importing":
      return { phase: "importing" };
    case "done":
      return { phase: "done", projectId: event.projectId };
    case "failed":
      return { phase: "failed", error: event.error };
  }
}

export const useOverleafImportStore = create<OverleafImportState>((set, get) => ({
  server: readServer(),
  status: null,
  projects: [],
  phase: "idle",
  error: null,
  selected: [],
  progress: {},
  importing: false,

  setServer(server) {
    const next = server.trim() || DEFAULT_OVERLEAF_SERVER;
    writeServer(next);
    set({ server: next, status: null, projects: [], selected: [], progress: {}, phase: "idle", error: null });
  },

  async refreshStatus() {
    try {
      const status = await overleafStatus(get().server);
      set({ status, server: status.server });
    } catch (error) {
      void logError("overleaf status", error);
    }
  },

  async open() {
    if (get().importing || get().phase === "signing-in") return;
    set({ phase: "checking", error: null });
    try {
      const status = await overleafStatus(get().server);
      set({ status, server: status.server });
      if (!status.signedIn) {
        set({ phase: "signed-out" });
        return;
      }
      await get().load();
    } catch (error) {
      void logError("overleaf status", error);
      set({ phase: "error", error });
    }
  },

  async load() {
    set({ phase: "loading", error: null });
    try {
      const listed = await overleafListProjects(get().server);
      const known = new Set(listed.projects.map((project) => project.id));
      set({
        status: listed.status,
        projects: listed.projects,
        selected: get().selected.filter((id) => known.has(id)),
        phase: "ready",
      });
    } catch (error) {
      if (isOverleafError(error, "session_expired") || isOverleafError(error, "signed_out")) {
        set((state) => ({
          phase: "signed-out",
          error: isOverleafError(error, "session_expired") ? error : null,
          status: state.status ? { ...state.status, signedIn: false, email: null } : null,
        }));
        return;
      }
      void logError("overleaf projects", error);
      set({ phase: "error", error });
    }
  },

  async signIn(title) {
    if (get().phase === "signing-in") return false;
    set({ phase: "signing-in", error: null });
    try {
      const status = await overleafSignIn(get().server, title);
      set({ status, server: status.server });
      await get().load();
      return true;
    } catch (error) {
      if (!isOverleafError(error, "sign_in_cancelled")) {
        void logError("overleaf sign in", error);
        set({ phase: "signed-out", error });
      } else {
        set({ phase: "signed-out" });
      }
      return false;
    }
  },

  async signOut() {
    try {
      const status = await overleafSignOut(get().server);
      set({ status, projects: [], selected: [], progress: {}, phase: "signed-out", error: null });
    } catch (error) {
      void logError("overleaf sign out", error);
      set({ error });
    }
  },

  toggle(id) {
    const selected = get().selected;
    set({ selected: selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id] });
  },

  setSelected(ids) {
    set({ selected: [...new Set(ids)] });
  },

  async importSelected(ids) {
    const wanted = [...new Set(ids ?? get().selected)];
    if (wanted.length === 0 || get().importing) return [];
    const queued: Record<string, OverleafRowProgress> = { ...get().progress };
    for (const id of wanted) queued[id] = { phase: "queued" };
    set({ importing: true, progress: queued, error: null });
    try {
      const outcomes = await overleafImportProjects(get().server, wanted, (event) => {
        set((state) => ({ progress: { ...state.progress, [event.remoteId]: progressFor(event) } }));
      });
      set((state) => {
        const progress = { ...state.progress };
        const importedAs = new Map<string, string>();
        for (const outcome of outcomes) {
          if (outcome.projectId) {
            progress[outcome.remoteId] = { phase: "done", projectId: outcome.projectId };
            importedAs.set(outcome.remoteId, outcome.projectId);
          } else if (outcome.error) {
            progress[outcome.remoteId] = { phase: "failed", error: outcome.error };
          }
        }
        return {
          progress,
          selected: state.selected.filter((id) => !importedAs.has(id)),
          projects: state.projects.map((project) =>
            importedAs.has(project.id) ? { ...project, importedAs: importedAs.get(project.id) ?? null } : project,
          ),
        };
      });
      if (outcomes.some((outcome) => outcome.error && isOverleafError(outcome.error, "session_expired"))) {
        set((state) => ({
          phase: "signed-out",
          status: state.status ? { ...state.status, signedIn: false, email: null } : null,
        }));
      }
      return outcomes;
    } catch (error) {
      void logError("overleaf import", error);
      set((state) => {
        const progress = { ...state.progress };
        for (const id of wanted) {
          if (progress[id]?.phase !== "done") progress[id] = { phase: "failed", error: String(error) };
        }
        return { progress, error };
      });
      if (isOverleafError(error, "session_expired") || isOverleafError(error, "signed_out")) {
        set({ phase: "signed-out" });
      }
      return [];
    } finally {
      set({ importing: false });
    }
  },
}));
