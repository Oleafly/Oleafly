import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { loadNamespace } from "/src/i18n";
import { prepareHarnessI18n } from "./harness-i18n";
import "/src/styles/globals.css";

const params = new URLSearchParams(window.location.search);
const SERVER = "https://www.overleaf.com";
const REMOTE = "6af963ebc9037022065bb53f";
const calls: { command: string; args: unknown }[] = [];

const linked = params.get("linked") === "1";
const reviewing = params.get("view") === "comments";
const chatting = params.get("view") === "chat";
const role = params.get("role") ?? "editor";
const commentsOn = params.get("comments") !== "off";
const canAccept = params.get("accept") !== "0";
const SELF = "64f1c2a3b4c5d6e7f8091a2b";
const BOB = "64f1c2a3b4c5d6e7f8091a2c";
const CAROL = "64f1c2a3b4c5d6e7f8091a2d";
const DANA = "5f9a1b2c3d4e5f6a7b8c9d0e";
const DOC = "6af963ebc9037022065bb541";
const AT = Date.now() - 3_600_000;
const person = (id: string, name: string) => ({ account_id: id, display_name: name, avatar_url: null, email: null, login: null });
const members = [
  { person: person(SELF, "Alice Chen"), role, granted_at: 0 },
  { person: person(BOB, "Bob Smith"), role: "editor", granted_at: 0 },
  { person: person(CAROL, "Carol Diaz"), role: "unknown", granted_at: 0, standing: "former" },
  { person: person(DANA, "Dana Ruiz"), role: "editor", granted_at: 0 },
];
const message = (id: string, author: string, body: string) => ({
  id,
  author,
  at: AT,
  body,
  editedAt: null,
  deleted: false,
  mentions: [],
  reactions: [],
  removed: false,
  pending: false,
  verified: true,
});
const thread = {
  id: "64f1c2a3b4c5d6e7f80900aa",
  fileId: DOC,
  anchor: { quote: "converges", range: { from: 30, to: 39 } },
  createdBy: BOB,
  createdAt: AT,
  resolved: null,
  messages: [message("64f1c2a3b4c5d6e7f80900ab", BOB, "Is 40 the right number?")],
  verified: true,
};
const change = (id: string, kind: "insert" | "delete", from: number, to: number, text: string) => ({
  id,
  fileId: DOC,
  kind,
  author: BOB,
  createdAt: AT,
  from,
  to,
  text,
  threadId: null,
  verified: true,
});
const changes = [
  change("c00001", "insert", 4, 9, "model"),
  change("c00002", "delete", 9, 9, "network"),
  change("c00003", "insert", 60, 66, "fully "),
];
let chatIds = 0;
const chatMessage = (author: string, body: string, minutes: number) => ({
  ...message(`64f1c2a3b4c5d6e7f8095${String(++chatIds).padStart(3, "0")}`, author, body),
  at: AT + minutes * 60_000,
});
const chat = [
  chatMessage(CAROL, "I set up the bibliography before I left", 0),
  chatMessage(BOB, "The bound is $\\mathcal{O}(n \\log n)$, notes at https://www.overleaf.com/learn", 5),
  chatMessage(SELF, "Will check it today", 10),
  chatMessage(DANA, "Figures are in", 15),
];
const chatOn = params.get("chat") !== "off";
const restricted = params.get("restricted") === "1";
const versions = [
  {
    id: "12",
    at: AT + 50 * 60_000,
    until: AT + 55 * 60_000,
    authors: [BOB],
    files: ["main.tex"],
    name: "Submitted draft",
    versionId: "64f1c2a3b4c5d6e7f80900f1",
  },
  { id: "9", at: AT + 20 * 60_000, until: AT + 21 * 60_000, authors: [SELF, DANA], files: ["main.tex", "refs.bib"], name: null, versionId: null },
];
const SAVED_ZIP = "/tmp/oleafly-e2e/Paper (version 12).zip";
const LINKED = {
  path: "refs.bib",
  provider: "project_file",
  url: null,
  sourceProject: "64b7f0c2a1e3d4b5c6a7e8f9",
  sourcePath: "/shared/library.bib",
};
const TREE = [
  { path: "main.tex", is_dir: false },
  { path: "refs.bib", is_dir: false },
];
const onOverleaf = {
  image: "texlive-full:2025.1",
  images: [
    { name: "texlive-full:2025.1", description: "TeX Live 2025" },
    { name: "texlive-full:2026.1", description: "TeX Live 2026" },
  ],
  bibliography: null as string | null,
  bibliographies: ["refs.bib", "more/extra.bib"],
  canChange: role === "owner" || role === "editor",
};
const linkedRefusal = params.get("refresh") === "refused";
let projectEngine: unknown = null;
function editMode() {
  if (role === "reviewer") {
    return { mode: "suggesting", switchable: false, locked: "reviewer", everyone: null, guests: null, manage: false };
  }
  if (!commentsOn) return { mode: "editing", switchable: false, locked: "server", everyone: null, guests: null, manage: false };
  return { mode: "editing", switchable: true, locked: null, everyone: false, guests: false, manage: role === "owner" };
}
const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  collab_comments_status: () => ({
    serverAllowed: commentsOn,
    projectEnabled: true,
    canComment: commentsOn,
    reactions: false,
    moderate: commentsOn && role === "owner",
    typing: false,
    suggestionThreads: false,
  }),
  collab_comment_thread_list: () => ({ rev: null, threads: commentsOn ? [thread] : [] }),
  collab_comment_counts: () => [],
  collab_comment_reply: (args) => message("64f1c2a3b4c5d6e7f80900ac", SELF, String(args.body)),
  collab_comment_resolve: () => ({ ...thread, resolved: { by: SELF, at: Date.now(), verified: true } }),
  collab_comment_create: (args) => ({
    ...thread,
    id: "64f1c2a3b4c5d6e7f80900ba",
    anchor: { quote: "", range: { from: Number(args.from), to: Number(args.to) } },
    createdBy: SELF,
    messages: [message("64f1c2a3b4c5d6e7f80900bb", SELF, String(args.body))],
  }),
  collab_suggestion_list: () => ({ rev: null, suggestions: changes, canAccept }),
  collab_suggestion_counts: () => [{ path: "main.tex", pending: changes.length }],
  collab_edit_mode_get: editMode,
  collab_chat_status: () => ({
    available: chatOn,
    post: chatOn,
    reactions: false,
    edit: true,
    clear: false,
    math: true,
    markdown: false,
    maxLength: 10_240,
  }),
  collab_chat_list: () => chat.map((entry) => ({ ...entry })),
  collab_chat_send: (args) => {
    const sent = chatMessage(SELF, String(args.body), 20);
    chat.push(sent);
    return { ...sent };
  },
  collab_chat_edit: (args) => {
    const found = chat.find((entry) => entry.id === args.id);
    if (!found) throw { code: "not_found", message: "" };
    Object.assign(found, { body: String(args.body), editedAt: Date.now() });
    return { ...found };
  },
  collab_chat_delete: (args) => {
    const found = chat.findIndex((entry) => entry.id === args.id);
    if (found >= 0) chat.splice(found, 1);
    return null;
  },
  collab_history_status: () => ({
    available: true,
    name: role !== "viewer",
    restore: role === "owner" || role === "editor",
    download: true,
    limited: params.get("limited") === "1",
  }),
  collab_history_list: () => ({ entries: versions, nextBefore: null, limited: params.get("limited") === "1" }),
  collab_history_file: (args) => ({
    path: String(args.path),
    text: "\\section{Results}\nThe model converges after 40 epochs.\n",
    existed: true,
  }),
  collab_history_changed_files: () => ["main.tex"],
  pick_save_path: () => SAVED_ZIP,
  collab_history_zip: () => 2048,
  overleaf_live_settings: () => ({ ...onOverleaf }),
  overleaf_live_set_setting: (args) => {
    if (args.setting === "bibliography") onOverleaf.bibliography = String(args.value);
    else onOverleaf.image = String(args.value);
    return null;
  },
  list_file_tree: () => ({ entries: TREE, truncated: false }),
  project_mutation_generation: () => 0,
  project_engine: () => projectEngine,
  overleaf_live_refresh_linked: () => {
    if (linkedRefusal) throw { code: "linked_refresh_failed", message: "The source file is not shared with you" };
    return null;
  },
  overleaf_live_learned_words: () => ({ account: `${SERVER}\n${SELF}`, words: ["Knuth"] }),
  overleaf_live_learn_words: (args) => ({
    learned: args.learn as string[],
    unlearned: args.unlearn as string[],
    stopped: null,
  }),
  overleaf_sync_status: () => ({
    linked,
    server: SERVER,
    remoteId: linked ? REMOTE : null,
    auto: true,
    lastSyncAt: linked ? Math.floor(Date.now() / 1000) - 600 : null,
    tokenSaved: params.get("token") === "1",
    importedFrom: { server: SERVER, projectId: REMOTE },
  }),
};

mockWindows("main");
mockIPC(
  (command, args) => {
    calls.push({ command, args });
    const handler = handlers[command];
    return handler ? handler((args ?? {}) as Record<string, unknown>) : null;
  },
  { shouldMockEvents: true },
);
const { emit } = await import("@tauri-apps/api/event");
Object.assign(window, { __calls: calls, __chat: { messages: chat, add: chatMessage, emit } });

await prepareHarnessI18n();
await loadNamespace("collab");
const [
  { createRoot },
  { OverleafSyncButton },
  { OverleafLiveSetting },
  { applyTheme },
  files,
  react,
  bridge,
  liveStore,
  settings,
  { OverleafBanners },
  { useOverleafNotices },
  { LATEX_ENGINE },
] = await Promise.all([
  import("react-dom/client"),
  import("/src/components/layout/overleaf-sync/OverleafSyncButton"),
  import("/src/components/layout/overleaf-sync/OverleafLiveSetting"),
  import("/src/lib/theme"),
  import("/src/store/files"),
  import("react"),
  import("/src/lib/collab-live-bridge"),
  import("/src/features/collab/live/live-store"),
  import("/src/store/settings"),
  import("/src/features/collab/live/OverleafBanners"),
  import("/src/features/collab/live/overleaf-notices"),
  import("/src/lib/document-engine"),
]);
projectEngine = LATEX_ENGINE;
applyTheme(params.get("theme") === "dark" ? "dark" : "light");
files.useFilesStore.setState({ projectId: "project-1" });

const live = params.get("live");
if (live) {
  const paused = live === "paused" || live === "gitpaused";
  const overleaf = { server: SERVER, remoteId: REMOTE, signedIn: live !== "signedout", paused };
  const statuses: Record<string, unknown> = {
    online: { state: "online" },
    sending: { state: "online" },
    connecting: { state: "connecting" },
    offline: { state: "offline", retry_in_ms: 4000 },
    reconnecting: { state: "offline", retry_in_ms: 4000 },
    maintenance: { state: "offline", retry_in_ms: 45_000 },
    idle: { state: "idle" },
    signedout: null,
    paused: null,
    gitpaused: null,
  };
  const going = !paused && live !== "signedout";
  liveStore.useCollabLiveStore.setState({
    projectId: "project-1",
    backend: going ? "overleaf" : null,
    overleaf,
    role: role as never,
    selfId: SELF,
    members: params.has("view") ? (members as never) : [],
    restricted,
    status: statuses[live] as never,
    pending: live === "offline" || live === "sending" ? 3 : 0,
  });
  bridge.useLiveBackend.setState({
    projectId: "project-1",
    backend: going ? "overleaf" : null,
    overleaf,
    linked: params.get("view") === "linked" ? [LINKED] : [],
  });
  if (params.get("view") === "linked") {
    bridge.useCollabEditorGate.setState({
      projectId: going ? "project-1" : null,
      viewer: role === "viewer",
      locked: role !== "owner" && role !== "editor",
      connecting: false,
    });
  }
  bridge.installOverleafLiveActions({
    pause: async () => ({ paused: false, unsent: ["main.tex", "sections/intro.tex"] }),
    resume: async () => undefined,
    unlink: async () => undefined,
  });
}
const notices = new Set(params.getAll("notice"));
const RESULTS = "\\section{Results}\nThe model converges after 40 epochs.\nAccuracy on the held-out set is 91.2\\%.\n";
useOverleafNotices.setState({
  projectId: "project-1",
  maintenance: notices.has("maintenance")
    ? { message: "The server is restarting for an update.", until: Date.now() + 45_000 }
    : null,
  reviews: notices.has("review")
    ? [
        {
          path: "sections/results.tex",
          mine: RESULTS,
          theirs: "\\section{Results}\nThe model converges after 55 epochs.\nAccuracy on the held-out set is 91.2\\%.\n",
        },
      ]
    : [],
  merged: notices.has("merged")
    ? [{ path: "main.tex", before: RESULTS, after: `${RESULTS}We report the mean of five runs.\n` }]
    : [],
  unsteady: notices.has("unsteady") ? ["refs.bib"] : [],
  slowAck: params.get("slow") === "1",
  failed: params.get("failed") === "1" ? "sections/results.tex" : null,
});
settings.useSettingsStore.getState().setOverleafLive(params.get("on") === "1");
const toolbar = react.createElement(
  "div",
  { "data-testid": "harness-toolbar", className: "flex h-10 items-center justify-end gap-1 border-b bg-background px-3" },
  react.createElement(OverleafSyncButton),
);
async function reviewView() {
  files.useFilesStore.setState({ activePath: "main.tex" });
  const [{ CommentsPane }, { EditModeSwitch }, comments, suggestions, mode] = await Promise.all([
    import("/src/features/collab/comments/CommentsPane"),
    import("/src/features/collab/suggestions/EditModeSwitch"),
    import("/src/features/collab/comments/comments-store"),
    import("/src/features/collab/suggestions/suggestions-store"),
    import("/src/features/collab/suggestions/edit-mode"),
  ]);
  comments.startComments();
  suggestions.startSuggestions();
  mode.startEditMode();
  return react.createElement(
    "div",
    { className: "flex h-screen flex-col" },
    react.createElement(
      "div",
      { "data-testid": "harness-toolbar", className: "flex h-10 items-center justify-end gap-1 border-b bg-background px-3" },
      react.createElement(EditModeSwitch, { projectId: "project-1" }),
    ),
    react.createElement("div", { className: "min-h-0 flex-1 bg-sidebar" }, react.createElement(CommentsPane)),
  );
}

async function chatView() {
  settings.useSettingsStore.setState({ railTab: "files", showTree: true });
  const [{ ChatPane }, store, { useChatRail }, { ChatRailIcon }] = await Promise.all([
    import("/src/features/collab/chat/ChatPane"),
    import("/src/features/collab/chat/chat-store"),
    import("/src/components/collab/chat-rail"),
    import("/src/components/collab/CollabSlots"),
  ]);
  store.startChat();
  function ChatTab() {
    const visible = useChatRail((state) => state.visible);
    if (!visible) return null;
    return react.createElement(
      "span",
      { "data-testid": "chat-rail-tab", className: "relative flex size-7 items-center justify-center" },
      react.createElement(ChatRailIcon, { className: "size-4" }),
    );
  }
  return react.createElement(
    "div",
    { className: "flex h-screen flex-col" },
    react.createElement(
      "div",
      { "data-testid": "harness-toolbar", className: "flex h-10 items-center justify-end gap-1 border-b bg-background px-3" },
      react.createElement(ChatTab),
    ),
    react.createElement("div", { className: "min-h-0 flex-1 bg-sidebar" }, react.createElement(ChatPane)),
  );
}

async function historyView() {
  const { SharedHistory } = await import("/src/features/collab/sharing/SharedHistory");
  files.useFilesStore.setState({ activePath: "main.tex", projectName: "Paper" });
  return react.createElement(
    "div",
    { className: "flex h-screen flex-col bg-sidebar" },
    react.createElement(SharedHistory, { open: true, onOpenChange: () => undefined }),
  );
}

async function settingsView() {
  const [{ ProjectInfoContent }, { EMPTY_DOCUMENT_STATS }] = await Promise.all([
    import("/src/components/editor/ProjectInfo"),
    import("/src/lib/document-stats"),
  ]);
  await loadNamespace("editor");
  const snapshot = { root: "/papers/grant", fileCount: 3, unreadable: [], stats: EMPTY_DOCUMENT_STATS, selectionWords: null };
  return react.createElement(
    "div",
    { className: "w-80 p-3" },
    react.createElement(ProjectInfoContent, { snapshot, surface: "source" }),
  );
}

async function linkedView() {
  const [{ FileTree }, { LinkedFileBanner }] = await Promise.all([
    import("/src/components/files/FileTree"),
    import("/src/features/collab/live/LinkedFileBanner"),
  ]);
  await loadNamespace("workspace");
  settings.useSettingsStore.setState({ hiddenFilePatterns: [] });
  files.useFilesStore.setState({
    projectId: "project-1",
    tree: TREE,
    treeTruncated: false,
    files: {},
    openTabs: ["refs.bib"],
    activePath: "refs.bib",
    mainDoc: "main.tex",
    manifestHome: "library",
    engine: projectEngine as never,
    engineLoaded: true,
  });
  return react.createElement(
    "div",
    { className: "flex h-screen flex-col" },
    react.createElement(LinkedFileBanner),
    react.createElement("div", { className: "min-h-0 w-72 flex-1 bg-sidebar" }, react.createElement(FileTree)),
  );
}

async function wordsView() {
  const [{ ProofreadingDictionarySection }, { useDictionary }, { startLearnedWords }] = await Promise.all([
    import("/src/components/settings/ProofreadingDictionarySection"),
    import("/src/lib/dictionary"),
    import("/src/features/collab/live/learned-words"),
  ]);
  await loadNamespace("settings");
  useDictionary.getState().ignoreGlobal("Oleafly");
  startLearnedWords();
  return react.createElement("div", { className: "max-w-2xl p-6" }, react.createElement(ProofreadingDictionarySection));
}

const PDF_SOURCE = "\\section{Results}\nThe model converges after 40 epochs on the held-out set.\n";

async function pdfBytes(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  page.drawText("Results", { x: 72, y: 700, size: 20, font });
  page.drawText("The model converges after 40 epochs on the held-out set.", { x: 72, y: 660, size: 14, font });
  return document.save({ useObjectStreams: false });
}

async function pdfView() {
  await import("/packages/preview/src/polyfills");
  const [{ PdfViewer }, { PdfAnnotationsHost }, { useCommentsRail }, { CommentsPane }, comments, bytes] =
    await Promise.all([
      import("/packages/preview/src/PdfViewer"),
      import("/src/components/preview/use-pdf-annotations"),
      import("/src/components/collab/comments-rail"),
      import("/src/features/collab/comments/CommentsPane"),
      import("/src/features/collab/comments/comments-store"),
      pdfBytes(),
      loadNamespace("annotations"),
    ]);
  files.useFilesStore.setState({
    activePath: "main.tex",
    mainDoc: "main.tex",
    files: { "main.tex": { content: PDF_SOURCE } } as never,
  });
  if (params.get("backend") === "server") {
    liveStore.useCollabLiveStore.setState({
      backend: "server",
      overleaf: null,
      share: { project_id: "project-1", server_id: "server-1", role, account_id: SELF } as never,
    });
    bridge.useLiveBackend.setState({ projectId: "project-1", backend: "server", overleaf: null });
  }
  comments.startComments();
  function PdfReview() {
    const pdfRef = react.useRef(null);
    const containerRef = react.useRef<HTMLDivElement>(null);
    const [slot, setSlot] = react.useState<HTMLElement | null>(null);
    const [annotations, setAnnotations] = react.useState<{ viewerProps: Record<string, unknown> } | null>(null);
    const comment = useCommentsRail((state) => state.canCompose);
    return react.createElement(
      "div",
      { className: "flex h-screen" },
      react.createElement(
        "div",
        { ref: containerRef, className: "relative h-full w-[680px] overflow-auto bg-muted" },
        react.createElement(PdfViewer, {
          ref: pdfRef,
          data: bytes,
          scale: 1,
          expectText: true,
          ...annotations?.viewerProps,
        } as never),
        react.createElement("div", { ref: setSlot }),
      ),
      react.createElement(PdfAnnotationsHost, {
        projectId: "project-1",
        annotate: false,
        comment,
        build: "build-1",
        documentReady: true,
        checkpoint: null,
        syncAvailable: false,
        pdfRef,
        containerRef,
        slot,
        onView: setAnnotations as never,
      } as never),
      react.createElement("div", { className: "min-h-0 w-96 bg-sidebar" }, react.createElement(CommentsPane)),
    );
  }
  return react.createElement(PdfReview);
}

const views: Record<string, () => Promise<ReturnType<typeof react.createElement>>> = {
  pdf: pdfView,
  words: wordsView,
  history: historyView,
  settings: settingsView,
  linked: linkedView,
};

let view: ReturnType<typeof react.createElement>;
const extra = views[params.get("view") ?? ""];
if (extra) {
  view = await extra();
} else if (params.get("view") === "card") {
  view = react.createElement("div", { className: "max-w-2xl space-y-2 p-6" }, react.createElement(OverleafLiveSetting));
} else if (reviewing) {
  view = await reviewView();
} else if (chatting) {
  view = await chatView();
} else {
  view = react.createElement("div", { className: "flex flex-col" }, toolbar, react.createElement(OverleafBanners));
}
createRoot(document.getElementById("root") as HTMLElement).render(view);
document.body.dataset.fixtureState = "mounted";
