import { create } from "zustand";
import {
  DEFAULT_OVERLEAF_SERVER,
  isOverleafError,
  overleafImportProjects,
  overleafInviteAccept,
  overleafLinkJoin,
  overleafLinkPreview,
  overleafListProjects,
  overleafOpenLive,
  overleafSignIn,
  overleafSignInWithBrowser,
  overleafSignOut,
  overleafStatus,
  overleafUseAccount,
  type OverleafImportEvent,
  type OverleafImportOutcome,
  type OverleafInvite,
  type OverleafLinkJoined,
  type OverleafLinkPreview,
  type OverleafProject,
  type OverleafSignInBrowser,
  type OverleafStatus,
} from "@/lib/overleaf";
import { readString, removeKey, writeString } from "@/lib/local-storage";
import { logError } from "@/lib/log";
import type { HomeProjectLayout } from "@/store/settings";
import type { CollabUnsentProject } from "@oleafly/backend-port";

const SERVER_KEY = "oleafly.overleaf.server";
const LAYOUT_KEY = "oleafly.overleaf.importLayout";

export type OverleafPhase = "idle" | "checking" | "signed-out" | "signing-in" | "loading" | "ready" | "error";

export type OverleafRowProgress =
  | { phase: "queued" }
  | { phase: "downloading"; received: number; total: number | null }
  | { phase: "importing" }
  | { phase: "opening" }
  | { phase: "done"; projectId: string }
  | { phase: "failed"; error: string; opening?: boolean };

interface OverleafImportState {
  server: string;
  status: OverleafStatus | null;
  unsent: CollabUnsentProject[] | null;
  unsentAccount: string | null;
  projects: OverleafProject[];
  invites: OverleafInvite[];
  accepting: string | null;
  inviteFailed: { id: string; error: unknown } | null;
  phase: OverleafPhase;
  signingWith: string | null;
  error: unknown;
  selected: string[];
  progress: Record<string, OverleafRowProgress>;
  importing: boolean;
  run: string[] | null;
  layout: HomeProjectLayout;
  setLayout(layout: HomeProjectLayout): void;
  setServer(server: string): void;
  refreshStatus(): Promise<void>;
  open(): Promise<void>;
  load(): Promise<void>;
  refresh(): Promise<void>;
  signIn(title: string): Promise<boolean>;
  signInWithBrowser(browser: OverleafSignInBrowser): Promise<boolean>;
  chooseAccount(userId: string): Promise<boolean>;
  signOut(keepLocalCopy?: boolean, account?: string | null): Promise<boolean>;
  staySignedIn(): void;
  toggle(id: string): void;
  setSelected(ids: readonly string[]): void;
  importSelected(ids?: readonly string[]): Promise<OverleafImportOutcome[]>;
  openLive(remoteId: string): Promise<string | null>;
  acceptInvite(inviteId: string): Promise<string | null>;
  previewLink(link: string): Promise<OverleafLinkPreview>;
  joinLink(link: string): Promise<OverleafLinkJoined>;
  startRun(): string[];
  finishRun(): void;
}

export function accountsOf(status: OverleafStatus | null): string {
  if (!status?.signedIn) return "";
  const users = status.accounts?.map((account) => account.userId) ?? [];
  return ["signed in", status.userId ?? "", ...users].join(",");
}

function readServer(): string {
  return readString(SERVER_KEY)?.trim() || DEFAULT_OVERLEAF_SERVER;
}

function readLayout(): HomeProjectLayout {
  return readString(LAYOUT_KEY) === "grid" ? "grid" : "list";
}

function writeServer(server: string): void {
  if (server === DEFAULT_OVERLEAF_SERVER) removeKey(SERVER_KEY);
  else writeString(SERVER_KEY, server);
}

function selectable(projects: readonly OverleafProject[], ids: Iterable<string>): string[] {
  const allowed = new Set(projects.filter((project) => !project.importedAs).map((project) => project.id));
  return [...new Set(ids)].filter((id) => allowed.has(id));
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

type SetState = (partial: Partial<OverleafImportState>) => void;

async function signInVia(
  set: SetState,
  get: () => OverleafImportState,
  signingWith: string | null,
  start: (server: string) => Promise<OverleafStatus>,
): Promise<boolean> {
  if (get().phase === "signing-in") return false;
  set({ phase: "signing-in", signingWith, error: null });
  try {
    const status = await start(get().server);
    set({ status, server: status.server, signingWith: null });
    await get().load();
    return true;
  } catch (error) {
    if (isOverleafError(error, "sign_in_cancelled")) {
      set({ phase: "signed-out", signingWith: null });
    } else {
      void logError("overleaf sign in", error);
      set({ phase: "signed-out", signingWith: null, error });
    }
    return false;
  }
}

export const useOverleafImportStore = create<OverleafImportState>((set, get) => ({
  server: readServer(),
  status: null,
  unsent: null,
  unsentAccount: null,
  projects: [],
  invites: [],
  accepting: null,
  inviteFailed: null,
  phase: "idle",
  signingWith: null,
  error: null,
  selected: [],
  progress: {},
  importing: false,
  run: null,
  layout: readLayout(),

  setLayout(layout) {
    writeString(LAYOUT_KEY, layout);
    set({ layout });
  },

  setServer(server) {
    const next = server.trim() || DEFAULT_OVERLEAF_SERVER;
    writeServer(next);
    set({
      server: next,
      status: null,
      projects: [],
      invites: [],
      selected: [],
      progress: {},
      run: null,
      phase: "idle",
      error: null,
    });
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
      const listed = await overleafListProjects(get().server, get().status?.userId);
      set({
        status: listed.status,
        projects: listed.projects,
        invites: listed.invites ?? [],
        selected: selectable(listed.projects, get().selected),
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

  async refresh() {
    try {
      const listed = await overleafListProjects(get().server, get().status?.userId);
      set({
        status: listed.status,
        projects: listed.projects,
        invites: listed.invites ?? [],
        selected: selectable(listed.projects, get().selected),
      });
    } catch (error) {
      void logError("overleaf projects", error);
    }
  },

  signIn(title) {
    return signInVia(set, get, null, (server) => overleafSignIn(server, title));
  },

  signInWithBrowser(browser) {
    return signInVia(set, get, browser.name, (server) => overleafSignInWithBrowser(server, browser.key));
  },

  async chooseAccount(userId) {
    const before = get();
    if (before.importing || before.status?.userId === userId) return false;
    try {
      const status = await overleafUseAccount(before.server, userId);
      const listed = before.phase === "ready" || before.phase === "error" || before.phase === "loading";
      set({ status, server: status.server, projects: [], invites: [], selected: [], progress: {}, run: null, error: null });
      if (listed) await get().load();
      return true;
    } catch (error) {
      void logError("overleaf choose account", error);
      set({ error });
      return false;
    }
  },

  async signOut(keepLocalCopy = false, account = null) {
    const before = get();
    const leaving = account ?? before.unsentAccount ?? before.status?.userId ?? null;
    try {
      const { unsent = [], ...status } = await overleafSignOut(before.server, keepLocalCopy, leaving);
      if (!keepLocalCopy && unsent.length > 0) {
        set({ status, unsent, unsentAccount: leaving, error: null });
        return true;
      }
      if (!status.signedIn) {
        set({
          status,
          unsent: null,
          unsentAccount: null,
          projects: [],
          invites: [],
          selected: [],
          progress: {},
          run: null,
          phase: "signed-out",
          error: null,
        });
        return true;
      }
      const listed = before.status?.userId === leaving && before.status?.userId !== status.userId;
      set({ status, unsent: null, unsentAccount: null, error: null });
      if (listed && before.phase !== "idle" && before.phase !== "signed-out") {
        set({ projects: [], invites: [], selected: [], progress: {}, run: null });
        await get().load();
      }
      return true;
    } catch (error) {
      void logError("overleaf sign out", error);
      set({ unsent: null, unsentAccount: null, error });
      return false;
    }
  },

  staySignedIn() {
    set({ unsent: null, unsentAccount: null });
  },

  toggle(id) {
    const selected = get().selected;
    if (selected.includes(id)) {
      set({ selected: selected.filter((item) => item !== id) });
      return;
    }
    if (selectable(get().projects, [id]).length === 0) return;
    set({ selected: [...selected, id] });
  },

  setSelected(ids) {
    set({ selected: selectable(get().projects, ids) });
  },

  async openLive(remoteId) {
    const before = get();
    if (before.importing || before.progress[remoteId]?.phase === "opening") return null;
    set((state) => ({ progress: { ...state.progress, [remoteId]: { phase: "opening" } }, error: null }));
    try {
      const opened = await overleafOpenLive(before.server, remoteId, before.status?.userId);
      set((state) => {
        const progress = { ...state.progress };
        delete progress[remoteId];
        return {
          progress,
          selected: state.selected.filter((id) => id !== remoteId),
          projects: state.projects.map((project) =>
            project.id === remoteId ? { ...project, importedAs: opened.projectId } : project,
          ),
        };
      });
      return opened.projectId;
    } catch (error) {
      void logError("overleaf open live", error);
      set((state) => ({
        progress: { ...state.progress, [remoteId]: { phase: "failed", error: String(error), opening: true } },
      }));
      if (isOverleafError(error, "session_expired") || isOverleafError(error, "signed_out")) {
        set({ phase: "signed-out" });
      }
      return null;
    }
  },

  async acceptInvite(inviteId) {
    const before = get();
    if (before.accepting) return null;
    set({ accepting: inviteId, inviteFailed: null });
    try {
      const joined = await overleafInviteAccept(before.server, inviteId, before.status?.userId);
      await get().refresh();
      return joined.projectId;
    } catch (error) {
      void logError("overleaf accept invite", error);
      set({ inviteFailed: { id: inviteId, error } });
      return null;
    } finally {
      set({ accepting: null });
    }
  },

  previewLink(link) {
    const { server, status } = get();
    return overleafLinkPreview(server, link, status?.userId);
  },

  async joinLink(link) {
    const { server, status } = get();
    const joined = await overleafLinkJoin(server, link, status?.userId);
    await get().refresh();
    return joined;
  },

  startRun() {
    const chosen = new Set(get().selected);
    const run = get()
      .projects.filter((project) => chosen.has(project.id))
      .map((project) => project.id);
    set({ run });
    return run;
  },

  finishRun() {
    if (get().importing) return;
    set({ run: null, selected: [], progress: {} });
  },

  async importSelected(ids) {
    const wanted = [...new Set(ids ?? get().selected)];
    if (wanted.length === 0 || get().importing) return [];
    const queued: Record<string, OverleafRowProgress> = { ...get().progress };
    for (const id of wanted) queued[id] = { phase: "queued" };
    set({ importing: true, progress: queued, error: null });
    try {
      const outcomes = await overleafImportProjects(
        get().server,
        wanted,
        (event) => {
          set((state) => ({ progress: { ...state.progress, [event.remoteId]: progressFor(event) } }));
        },
        get().status?.userId,
      );
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
