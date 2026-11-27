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
  unsentServer: string | null;
  repeated: string | null;
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
  switchAccount(server: string, userId: string): Promise<boolean>;
  signOut(keepLocalCopy?: boolean, account?: string | null, server?: string | null): Promise<boolean>;
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
type Asked = Pick<OverleafImportState, "server" | "status">;

const NOTHING_UNSENT = { unsent: null, unsentAccount: null, unsentServer: null } satisfies Partial<OverleafImportState>;
const NO_LIST = { projects: [], invites: [], selected: [], progress: {}, run: null } satisfies Partial<OverleafImportState>;
const LISTED: ReadonlySet<OverleafPhase> = new Set(["loading", "ready", "error"]);

function signedOutBy(error: unknown): boolean {
  return isOverleafError(error, "session_expired") || isOverleafError(error, "signed_out");
}

export function repeatsAccount(before: OverleafStatus | null, status: OverleafStatus): string | null {
  const same = before?.signedIn === true && !!before.userId && before.userId === status.userId;
  return same ? (status.email ?? status.userId ?? null) : null;
}

function movedOn(asked: Asked, now: Asked): boolean {
  return now.server !== asked.server || (now.status?.userId ?? null) !== (asked.status?.userId ?? null);
}

function withOutcomes(
  state: OverleafImportState,
  outcomes: readonly OverleafImportOutcome[],
): Pick<OverleafImportState, "progress" | "selected" | "projects"> {
  const progress = { ...state.progress };
  const importedAs = new Map<string, string>();
  for (const { remoteId, projectId, error } of outcomes) {
    if (projectId) {
      progress[remoteId] = { phase: "done", projectId };
      importedAs.set(remoteId, projectId);
    } else if (error) {
      progress[remoteId] = { phase: "failed", error };
    }
  }
  return {
    progress,
    selected: state.selected.filter((id) => !importedAs.has(id)),
    projects: state.projects.map((project) =>
      importedAs.has(project.id) ? { ...project, importedAs: importedAs.get(project.id) ?? null } : project,
    ),
  };
}

async function follow(set: SetState, get: () => OverleafImportState, status: OverleafStatus): Promise<void> {
  const before = get();
  const was = before.status?.userId;
  if (!was || was === status.userId) {
    set({ status, server: status.server });
    return;
  }
  set({ status, server: status.server, ...NO_LIST });
  if (LISTED.has(before.phase)) await get().load();
}

async function showList(
  set: SetState,
  get: () => OverleafImportState,
  shown: Partial<OverleafImportState> = {},
): Promise<void> {
  const asked = get();
  const was = asked.status?.userId;
  const { status, projects, invites = [] } = await overleafListProjects(asked.server, was);
  if (movedOn(asked, get())) return;
  if (was && status.userId !== was) {
    await follow(set, get, status);
    return;
  }
  set({ status, projects, invites, selected: selectable(projects, get().selected), ...shown });
}

async function afterSignOut(
  set: SetState,
  get: () => OverleafImportState,
  { before, leaving, status }: { before: OverleafImportState; leaving: string | null; status: OverleafStatus },
): Promise<void> {
  if (!status.signedIn) {
    set({ status, ...NOTHING_UNSENT, ...NO_LIST, phase: "signed-out", error: null });
    return;
  }
  const listed = before.status?.userId === leaving && before.status?.userId !== status.userId;
  set({ status, ...NOTHING_UNSENT, error: null });
  if (listed && before.phase !== "idle" && before.phase !== "signed-out") {
    set(NO_LIST);
    await get().load();
  }
}

async function signInVia(
  set: SetState,
  get: () => OverleafImportState,
  signingWith: string | null,
  start: (server: string) => Promise<OverleafStatus>,
): Promise<boolean> {
  if (get().phase === "signing-in") return false;
  const before = get().status;
  set({ phase: "signing-in", signingWith, error: null, repeated: null });
  try {
    const status = await start(get().server);
    set({ status, server: status.server, signingWith: null, repeated: repeatsAccount(before, status) });
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
  unsentServer: null,
  repeated: null,
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
    set({ server: next, status: null, ...NO_LIST, phase: "idle", error: null, repeated: null });
  },

  async refreshStatus() {
    const asked = get();
    try {
      const status = await overleafStatus(asked.server);
      if (movedOn(asked, get())) return;
      await follow(set, get, status);
    } catch (error) {
      void logError("overleaf status", error);
    }
  },

  async open() {
    if (get().importing || get().phase === "signing-in") return;
    set({ phase: "checking", error: null, repeated: null });
    const asked = get();
    const left = (answered?: string) => {
      const { phase, server } = get();
      return phase !== "checking" || (server !== asked.server && server !== answered);
    };
    try {
      const status = await overleafStatus(asked.server);
      if (left(status.server)) return;
      if (!movedOn(asked, get())) set({ status, server: status.server });
      if (!get().status?.signedIn) {
        set({ phase: "signed-out" });
        return;
      }
      await get().load();
    } catch (error) {
      void logError("overleaf status", error);
      if (!left()) set({ phase: "error", error });
    }
  },

  async load() {
    set({ phase: "loading", error: null });
    const asked = get();
    try {
      await showList(set, get, { phase: "ready" });
    } catch (error) {
      const signedOut = signedOutBy(error);
      if (!signedOut) void logError("overleaf projects", error);
      if (movedOn(asked, get())) return;
      if (signedOut) {
        set((state) => ({
          phase: "signed-out",
          error: isOverleafError(error, "session_expired") ? error : null,
          status: state.status ? { ...state.status, signedIn: false, email: null } : null,
        }));
        return;
      }
      set({ phase: "error", error });
    }
  },

  async refresh() {
    try {
      await showList(set, get);
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
      if (get().server !== before.server) return false;
      set({ error: null });
      await follow(set, get, status);
      return true;
    } catch (error) {
      void logError("overleaf choose account", error);
      set({ error });
      return false;
    }
  },

  switchAccount(server, userId) {
    if (get().importing) return Promise.resolve(false);
    if (get().server !== server) get().setServer(server);
    return get().chooseAccount(userId);
  },

  async signOut(keepLocalCopy = false, account = null, server = null) {
    const before = get();
    const from = server ?? before.unsentServer ?? before.server;
    const here = from === before.server;
    const leaving = account ?? before.unsentAccount ?? before.status?.userId ?? null;
    try {
      const { unsent = [], ...status } = await overleafSignOut(from, keepLocalCopy, leaving);
      if (!keepLocalCopy && unsent.length > 0) {
        set({ ...(here ? { status } : {}), unsent, unsentAccount: leaving, unsentServer: from, error: null });
      } else if (here) {
        await afterSignOut(set, get, { before, leaving, status });
      } else {
        set({ ...NOTHING_UNSENT, error: null });
      }
      return true;
    } catch (error) {
      void logError("overleaf sign out", error);
      set({ ...NOTHING_UNSENT, error });
      return false;
    }
  },

  staySignedIn() {
    set(NOTHING_UNSENT);
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
      if (movedOn(before, get())) return null;
      set((state) => ({
        progress: { ...state.progress, [remoteId]: { phase: "failed", error: String(error), opening: true } },
      }));
      if (signedOutBy(error)) set({ phase: "signed-out" });
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
    const asked = get();
    const wanted = [...new Set(ids ?? asked.selected)];
    if (wanted.length === 0 || asked.importing) return [];
    const queued: Record<string, OverleafRowProgress> = { ...asked.progress };
    for (const id of wanted) queued[id] = { phase: "queued" };
    set({ importing: true, progress: queued, error: null });
    try {
      const outcomes = await overleafImportProjects(
        asked.server,
        wanted,
        (event) => {
          set((state) => ({ progress: { ...state.progress, [event.remoteId]: progressFor(event) } }));
        },
        asked.status?.userId,
      );
      set((state) => withOutcomes(state, outcomes));
      if (outcomes.some(({ error }) => isOverleafError(error, "session_expired")) && !movedOn(asked, get())) {
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
      if (signedOutBy(error) && !movedOn(asked, get())) set({ phase: "signed-out" });
      return [];
    } finally {
      set({ importing: false });
    }
  },
}));
