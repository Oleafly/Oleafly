import type { CollabCommentThread } from "@oleafly/backend-port";
import type { CompileOutput } from "@oleafly/compile-port";
import { create } from "zustand";
import type { DiscardReason } from "@/features/collab/live/remote-session";
import type { WebMe } from "./api";
import type { GatewayEnd, GatewayState } from "./gateway";
import type { PlacedRange } from "./overlays";
import type {
  CollabChatMessage,
  CollabEditMode,
  CollabOutputInfo,
  CollabProjectRole,
  CollabSuggestion,
  CompileSettings,
  WebFeatures,
  WebFile,
  WebPeer,
  WebPerson,
} from "./protocol";

export type PaneView = "files" | "source" | "pdf" | "comments";
export type SidePane = "pdf" | "comments";
export type DiscussionTab = "comments" | "chat";

export interface CommentDraft {
  fileId: string;
  path: string;
  from: number;
  to: number;
  quote: string;
}

export type CompileStatus = "idle" | "running" | "done" | "failed";
export type ShareStatus = "idle" | "sharing" | "shared" | "failed";

export interface CompileState {
  /** An engine in this browser compiles the project. */
  ready: boolean;
  status: CompileStatus;
  output: CompileOutput | null;
  finishedAt: number | null;
  /** The compile failed before it made any output, with this message. */
  error: string | null;
  /** Which PDF the pane shows: this browser's compile, or the one the project shares. */
  shown: "local" | "shared";
  share: ShareStatus;
  /** The shared output this browser uploaded, so it isn't downloaded back. */
  sharedKey: string | null;
  logOpen: boolean;
}

export interface Notice {
  code: string;
  message: string;
  at: number;
}

export interface WebState {
  me: WebMe | null;
  projectId: string | null;
  title: string;
  owner: WebPerson | null;
  role: CollabProjectRole;
  roleChanged: CollabProjectRole | null;
  features: WebFeatures;
  files: WebFile[];
  activeFileId: string | null;
  activePath: string | null;
  docVersion: number;
  loaded: Readonly<Record<string, boolean>>;
  removedPath: string | null;
  connection: GatewayState;
  end: GatewayEnd | null;
  chosenMode: CollabEditMode;
  threads: Readonly<Record<string, readonly CollabCommentThread[]>>;
  suggestions: Readonly<Record<string, readonly CollabSuggestion[]>>;
  chat: readonly CollabChatMessage[];
  output: readonly CollabOutputInfo[];
  compileSettings: CompileSettings;
  compile: CompileState;
  peers: readonly WebPeer[];
  people: Readonly<Record<string, WebPerson>>;
  notice: Notice | null;
  discarded: DiscardReason | null;
  selection: PlacedRange | null;
  draft: CommentDraft | null;
  selectedThreadId: string | null;
  selectedSuggestionId: string | null;
  view: PaneView;
  side: SidePane;
  discussion: DiscussionTab;
}

export const DEFAULT_FEATURES: WebFeatures = { comments: true, suggestions: true, chat: true };

export function initialCompileState(): CompileState {
  return {
    ready: false,
    status: "idle",
    output: null,
    finishedAt: null,
    error: null,
    shown: "shared",
    share: "idle",
    sharedKey: null,
    logOpen: false,
  };
}

export function patchCompile(patch: Partial<CompileState>): void {
  useWeb.setState((state) => ({ compile: { ...state.compile, ...patch } }));
}

export function initialWebState(): WebState {
  return {
    me: null,
    projectId: null,
    title: "",
    owner: null,
    role: "unknown",
    roleChanged: null,
    features: DEFAULT_FEATURES,
    files: [],
    activeFileId: null,
    activePath: null,
    docVersion: 0,
    loaded: {},
    removedPath: null,
    connection: "connecting",
    end: null,
    chosenMode: "editing",
    threads: {},
    suggestions: {},
    chat: [],
    output: [],
    compileSettings: {},
    compile: initialCompileState(),
    peers: [],
    people: {},
    notice: null,
    discarded: null,
    selection: null,
    draft: null,
    selectedThreadId: null,
    selectedSuggestionId: null,
    view: "source",
    side: "pdf",
    discussion: "comments",
  };
}

export const useWeb = create<WebState>(() => initialWebState());

export function resetWebState(patch: Partial<WebState> = {}): void {
  useWeb.setState({ ...initialWebState(), ...patch }, true);
}

export function mergePeople(
  current: Readonly<Record<string, WebPerson>>,
  people: readonly (WebPerson | null | undefined)[],
): Readonly<Record<string, WebPerson>> {
  let next: Record<string, WebPerson> | null = null;
  for (const person of people) {
    if (!person?.accountId) continue;
    const known = (next ?? current)[person.accountId];
    const merged: WebPerson = {
      accountId: person.accountId,
      name: person.name || known?.name || "",
      avatarUrl: person.avatarUrl ?? known?.avatarUrl ?? null,
      login: person.login ?? known?.login ?? null,
    };
    if (
      known &&
      known.name === merged.name &&
      known.avatarUrl === merged.avatarUrl &&
      known.login === merged.login
    ) {
      continue;
    }
    next ??= { ...current };
    next[person.accountId] = merged;
  }
  return next ?? current;
}

export function mergeChat(
  current: readonly CollabChatMessage[],
  incoming: readonly CollabChatMessage[],
): CollabChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
