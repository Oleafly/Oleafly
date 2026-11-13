import { ChevronDown, ChevronUp, History, MessagesSquare, Plus } from "lucide-react";
import { createContext, memo, Suspense, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type Ref, type RefObject } from "react";
import { lazy } from "@/lib/preloadable";
import { useTranslation } from "react-i18next";
import {
  AssistantScopeProvider,
  type AssistantLayoutParts,
  type AssistantScopeComposer,
  type AssistantScopeValue,
} from "@/components/ai/assistant-scope";
import { activeChatRun, subscribeChatRun } from "@/components/ai/chat-run-registry";
import { ChatCore } from "@/components/ai/ChatCore";
import type { ComposerCommand } from "@/components/ai/composer-command-registry";
import type { ChatComposerHandle } from "@/components/ai/composer/ChatComposer";
import type { ModelSelectorGroup } from "@/components/ai/ModelSelector";
import { RuntimeSwitch } from "@/components/ai/RuntimeSwitch";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { acpCancel, acpUsable } from "@/lib/acp";
import { logError } from "@/lib/log";
import { openNoteEditor } from "@/lib/open-note-editors";
import { listFiles, listNoteTags, noteFacts, noteSearch, type FileEntry } from "@/lib/tauri";
import { useAgentMemoryStore } from "@/store/agent-memory";
import { useAgentTodoStore } from "@/store/agent-todos";
import { useAcpSessionsStore, type AcpSelection } from "@/store/acp-sessions";
import { selectScopeRuntime, useAssistantRuntimeStore } from "@/store/assistant-runtime";
import { shownChats, useChatsStore } from "@/store/chats";
import { builtinComposerId, draftText, useComposerDrafts } from "@/store/composer-drafts";
import { CollapsePromptButton, GlowRing, PromptDock, type PromptDockHandle } from "./AgentPrompt";
import { noteAcpTarget, noteContextSelection, reviewAfterClose, useNoteAcpEdits, type ClosedNoteReview } from "./note-acp";
import { useNoteAcpReadOnly, useNoteAcpWriteGuard } from "./note-acp-read-only";
import { actsOnPassage, hiddenResearchActions, researchTask, type NotePassage, type NotePromptFacts } from "./note-assistant-prompt";
import { createNoteScope, noteContextBlock, noteMentions, noteScopeKey, noteStateKey } from "./note-assistant-scope";
import type { NoteToolDeps } from "./note-assistant-tools";
import type { NoteEdit } from "./note-edits";
import { linkIdsOf } from "./app-notes";
import { readNoteFacts } from "./note-file";
import { noteModelMemory } from "./note-model-memory";
import { proposeNoteEdits, registerNoteEditor, reviewedNoteSource } from "./note-pending-suggestions";
import { noteClipboardText } from "./note-selection";
import { useNotesData } from "./notes-data";
import { RESEARCH_ACTIONS } from "./research-actions";
import type { NoteItem } from "./types";

const AcpWorkspaceAssistant = lazy(() =>
  import("@/components/ai/acp/AcpWorkspaceAssistant").then((module) => ({
    default: module.AcpWorkspaceAssistant,
  })),
);

export interface NoteEditorBridge {
  readSource: () => string;
  propose: (edits: readonly NoteEdit[]) => number;
  pending: () => number;
}

export interface NoteAssistantHandle {
  focus: () => void;
  quote: (text: string) => void;
}

interface NoteAssistantProps {
  note: NoteItem;
  bridge: NoteEditorBridge;
  shortcutScope: RefObject<HTMLElement | null>;
  viewOnly?: boolean;
  ref?: Ref<NoteAssistantHandle>;
}

interface NoteUi {
  runtimeSwitch: ReactNode;
  onStatus: (working: boolean, stop: () => void) => void;
  collapse: () => void;
  viewOnly: boolean;
}

const NoteUiContext = createContext<NoteUi | null>(null);
const CLI_GROUP_ID = "note-cli-agents";
const QUOTE_CHARS = 2_000;
const LINK_CACHE_MS = 10_000;
const NO_FILES: FileEntry[] = [];
const NO_NOTES: readonly NoteItem[] = [];
const NO_LINKS: ReadonlyMap<string, string> = new Map();
const SHARED_NOTE_INSTRUCTIONS =
  "This note is shared with other people. Stay inside your working folder: don't read, list or search any file outside it.";

const mountedScopes = new Map<string, number>();
let catalogRefresh: Promise<unknown> | null = null;

function refreshAgentCatalog(): void {
  if (catalogRefresh) return;
  const request = useAcpSessionsStore
    .getState()
    .refreshCatalog()
    .catch(() => false)
    .finally(() => {
      if (catalogRefresh === request) catalogRefresh = null;
    });
  catalogRefresh = request;
}

function forgetScope(scope: string): void {
  useChatsStore.getState().forgetScope(scope);
  useAgentTodoStore.getState().forgetScope(scope);
  useAgentMemoryStore.getState().forgetScope(scope);
}

function holdScope(scope: string): () => void {
  mountedScopes.set(scope, (mountedScopes.get(scope) ?? 0) + 1);
  return () => {
    const left = (mountedScopes.get(scope) ?? 1) - 1;
    if (left > 0) {
      mountedScopes.set(scope, left);
      return;
    }
    mountedScopes.delete(scope);
    const run = activeChatRun(scope);
    if (!run) {
      forgetScope(scope);
      return;
    }
    run.pendingApproval?.resolve(false);
    run.controller.abort();
    const stop = subscribeChatRun(() => {
      if (activeChatRun(scope)) return;
      stop();
      if (!mountedScopes.has(scope)) forgetScope(scope);
    });
  };
}

function quoteBlock(text: string): string {
  const flat = text.trim().slice(0, QUOTE_CHARS);
  return `${flat
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}\n\n`;
}

function selectedPassage(noteId: string, source: string): NotePassage | null {
  const editor = openNoteEditor(noteId)?.editor;
  const selection = editor?.state.selection;
  if (!editor || !selection || selection.empty) return null;
  const text = noteClipboardText(selection.content(), editor.state.doc).trim();
  if (!text) return null;
  const at = source.indexOf(text);
  const line = at >= 0 && !source.includes(text, at + 1) ? source.slice(0, at).split("\n").length : null;
  return { text, line };
}

function useLinkIds(): () => Promise<ReadonlyMap<string, string>> {
  const cache = useRef<{ at: number; links: Promise<ReadonlyMap<string, string>> } | null>(null);
  return useCallback(() => {
    const cached = cache.current;
    if (cached && Date.now() - cached.at < LINK_CACHE_MS) return cached.links;
    const links = noteFacts().then((facts): ReadonlyMap<string, string> => linkIdsOf(facts));
    cache.current = { at: Date.now(), links };
    links.catch(() => {
      if (cache.current?.links === links) cache.current = null;
    });
    return links;
  }, []);
}

function DockCard({ onCollapse, children }: Readonly<{ onCollapse: () => void; children: ReactNode }>) {
  return (
    <div className="relative rounded-[1.375rem] border bg-card p-4 pr-10 text-sm text-muted-foreground shadow-sm">
      {children}
      <CollapsePromptButton onCollapse={onCollapse} />
    </div>
  );
}

function ViewOnlyNotice({ onCollapse }: Readonly<{ onCollapse: () => void }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <DockCard onCollapse={onCollapse}>
      <p data-note-assistant-view-only>{t(($) => $.notes.assistant.viewOnly)}</p>
    </DockCard>
  );
}

function noteComposerSlot(ui: NoteUi | null, parts: AssistantLayoutParts): ReactNode {
  if (ui?.viewOnly) return <ViewOnlyNotice onCollapse={ui.collapse} />;
  if (parts.setup) return <DockCard onCollapse={() => ui?.collapse()}>{parts.setup}</DockCard>;
  return parts.composer;
}

function glowPromptFrame(onCollapse: () => void) {
  return (node: ReactNode, working: boolean) => (
    <div data-working={working || undefined} className="note-prompt-glow relative isolate rounded-[1.375rem]">
      <GlowRing />
      {node}
      <CollapsePromptButton onCollapse={onCollapse} />
    </div>
  );
}

function NoteConversation({ parts }: Readonly<{ parts: AssistantLayoutParts }>) {
  const { t } = useTranslation(["notes", "ai"]);
  const ui = useContext(NoteUiContext);
  const [open, setOpen] = useState(true);
  const { working, stop } = parts;
  const onStatus = ui?.onStatus;
  useEffect(() => {
    onStatus?.(working, stop);
  }, [onStatus, stop, working]);
  useEffect(() => {
    if (working) setOpen(true);
  }, [working]);
  const header = (
    <div className="flex items-center gap-1">
      {ui?.runtimeSwitch}
      {parts.tools}
      {parts.chatCount > 0 && (
        <Button type="button" variant="ghost" size="xs" onClick={parts.openHistory}>
          <History aria-hidden />
          {t(($) => $.ai.header.chatHistory)}
        </Button>
      )}
      {parts.hasMessages && (
        <Button type="button" variant="ghost" size="xs" disabled={!parts.canStartChat} onClick={parts.newChat}>
          <Plus aria-hidden />
          {t(($) => $.notes.assistant.newChat)}
        </Button>
      )}
    </div>
  );
  return (
    <>
      {parts.hasMessages && open && (
        <section
          aria-label={t(($) => $.notes.assistant.conversation)}
          className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm"
        >
          <div className="ml-auto flex items-center gap-1 px-1.5 py-1">
            {header}
            <Tooltip label={t(($) => $.notes.assistant.foldConversation)}>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={t(($) => $.notes.assistant.foldConversation)}
                onClick={() => setOpen(false)}
                className="size-6 p-0 text-muted-foreground"
              >
                <ChevronDown aria-hidden />
              </Button>
            </Tooltip>
          </div>
          <div
            ref={parts.scrollRef}
            onScroll={parts.onScroll}
            data-note-thread
            className="max-h-[45vh] overflow-y-auto overscroll-contain border-t px-3 py-3"
          >
            {parts.messages}
          </div>
        </section>
      )}
      {parts.hasMessages && !open && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="h-auto w-full justify-start rounded-xl border bg-card px-3 py-2 text-xs font-normal text-muted-foreground shadow-sm [&_svg]:size-3.5"
        >
          <MessagesSquare aria-hidden />
          <span className="min-w-0 flex-1 truncate text-left">{t(($) => $.notes.assistant.showConversation)}</span>
          {working && <Spinner size="xs" />}
          <ChevronUp aria-hidden />
        </Button>
      )}
      {!parts.hasMessages && <div className="flex justify-end">{header}</div>}
      {parts.footer}
      {noteComposerSlot(ui, parts)}
      {parts.dialogs}
    </>
  );
}

const NOTE_LAYOUT = { render: (parts: AssistantLayoutParts) => <NoteConversation parts={parts} /> };

function NoteAcpPanel({
  note,
  bridge,
  onStatus,
  onCollapse,
  runtimeSwitch,
  tree,
  relatedName,
  files,
}: Readonly<{
  note: NoteItem;
  bridge: NoteEditorBridge;
  onStatus: (working: boolean, stop: () => void) => void;
  onCollapse: () => void;
  runtimeSwitch: ReactNode;
  tree: readonly FileEntry[];
  relatedName: string | null;
  files: Pick<ClosedNoteReview, "load" | "save">;
}>) {
  const { t } = useTranslation(["notes", "ai"]);
  const target = noteAcpTarget(note.id, note.relatedProjectId);
  const session = useAcpSessionsStore((state) => {
    const id = state.activeByProject[target.slot];
    return id ? state.sessions[id] : undefined;
  });
  const catalog = useAcpSessionsStore((state) => state.catalog);
  const running = session?.status === "running" || session?.status === "cancelling";
  const sessionId = session?.id ?? null;
  const stop = useCallback(() => {
    if (!sessionId) return;
    void acpCancel(target.projectId, sessionId).catch((error: unknown) => logError("stop the note agent", error));
  }, [sessionId, target.projectId]);
  useEffect(() => {
    onStatus(running, stop);
  }, [onStatus, running, stop]);
  const readOnly = useNoteAcpReadOnly(target.projectId, target.slot, target.related);
  const writeRequest = useNoteAcpWriteGuard(target.projectId, target.slot, target.related);
  const writeAgent = writeRequest
    ? (catalog.find((agent) => agent.definition.id === writeRequest.agentId)?.definition.name ?? writeRequest.agentId)
    : null;
  useNoteAcpEdits(target.slot, target.related, (edits) => {
    bridge.propose(edits);
  });
  const shared = note.shared === true;
  const extraSelections = useCallback((): readonly AcpSelection[] => {
    const context = noteContextSelection(note.title, bridge.readSource(), target);
    if (!shared) return [context];
    return [context, { id: "note-shared", path: null, text: SHARED_NOTE_INSTRUCTIONS, label: note.title }];
  }, [bridge, note.title, shared, target]);
  const slot = target.slot;
  const noteId = note.id;
  const closing = useRef({ related: target.related, files });
  closing.current = { related: target.related, files };
  useEffect(
    () => () => {
      const { related, files: noteFiles } = closing.current;
      if (!related) reviewAfterClose({ noteId, slot, ...noteFiles });
      void useAcpSessionsStore.getState().releaseSlot(slot);
    },
    [noteId, slot],
  );
  return (
    <section
      data-working={running || undefined}
      aria-label={t(($) => $.notes.assistant.label)}
      className="note-prompt-glow relative isolate flex h-[min(34rem,60vh)] flex-col overflow-hidden rounded-[1.375rem] border bg-card shadow-sm"
    >
      <GlowRing />
      <div className="flex h-9 shrink-0 items-center gap-1 border-b pl-2 pr-9">{runtimeSwitch}</div>
      {target.related && !readOnly && (
        <p data-note-agent-writes className="shrink-0 border-b px-3 py-1.5 text-xs text-muted-foreground">
          {t(($) => $.notes.assistant.agentCanEdit)}
        </p>
      )}
      {writeRequest && (
        <section
          aria-label={t(($) => $.notes.assistant.allowWritesLabel)}
          data-note-agent-consent
          className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs"
        >
          <p className="min-w-0 flex-1 text-foreground">
            {t(($) => $.notes.assistant.allowWritesAsk, {
              agent: writeAgent ?? "",
              project: relatedName ?? note.project,
            })}
          </p>
          <Button type="button" variant="ghost" size="xs" onClick={writeRequest.decline}>
            {t(($) => $.notes.assistant.dontSend)}
          </Button>
          <Button type="button" size="xs" onClick={writeRequest.allow}>
            {t(($) => $.notes.assistant.allowWrites)}
          </Button>
        </section>
      )}
      <CollapsePromptButton onCollapse={onCollapse} />
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={<p className="p-4 text-sm text-muted-foreground">{t(($) => $.ai.shell.loadingAgents)}</p>}
        >
          <AcpWorkspaceAssistant
            projectId={target.projectId}
            slot={target.slot}
            projectName={note.title}
            tree={target.related ? undefined : tree}
            variant="note"
            extraSelections={extraSelections}
          />
        </Suspense>
      </div>
    </section>
  );
}

interface NoteAssistantBodyProps {
  note: NoteItem;
  bridge: NoteEditorBridge;
  viewOnly: boolean;
  acp: boolean;
  working: boolean;
  composerHandle: RefObject<ChatComposerHandle | null>;
  onStatus: (working: boolean, stop: () => void) => void;
  collapse: () => void;
  mounted: RefObject<boolean>;
}

function NoteAssistantBody({ note, bridge, viewOnly, acp, working, composerHandle, onStatus, collapse, mounted }: Readonly<NoteAssistantBodyProps>) {
  const { t } = useTranslation(["notes", "ai"]);
  const data = useNotesData();
  const scopeKey = noteScopeKey(note.id);
  const setScopeRuntime = useAssistantRuntimeStore((state) => state.setScopeRuntime);
  const catalog = useAcpSessionsStore((state) => state.catalog);
  const cliAgents = useMemo(() => catalog.filter(acpUsable), [catalog]);
  const [tree, setTree] = useState<readonly FileEntry[]>(NO_FILES);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  const dataRef = useRef(data);
  dataRef.current = data;
  const viewOnlyRef = useRef(viewOnly);
  viewOnlyRef.current = viewOnly;
  const shared = note.shared === true;
  const allLinkIds = useLinkIds();
  const linkIds = useCallback(() => (shared ? Promise.resolve(NO_LINKS) : allLinkIds()), [allLinkIds, shared]);
  const personalNotes = shared ? NO_NOTES : data.notes;
  const related = note.relatedProjectId ?? null;
  const relatedName = related ? (data.projects?.find((project) => project.id === related)?.name ?? note.project) : null;
  const latestRun = data.latestRun?.(note.id) ?? null;
  const slot = noteAcpTarget(note.id, related).slot;
  const homeProject = note.home?.projectId;
  const homePath = note.home?.path;
  const folder = homeProject ?? note.id;

  useEffect(() => {
    mounted.current = true;
    refreshAgentCatalog();
    return () => {
      mounted.current = false;
    };
  }, [mounted]);

  const refreshTree = useCallback(() => {
    listFiles(folder).then(setTree, (error: unknown) => logError("list the note folder", error));
  }, [folder]);

  useEffect(() => {
    refreshTree();
  }, [refreshTree]);

  const wasWorking = useRef(false);
  useEffect(() => {
    if (wasWorking.current && !working) refreshTree();
    wasWorking.current = working;
  }, [refreshTree, working]);

  const hasCli = cliAgents.length > 0;
  const runtimeSwitch = useMemo(() => (hasCli ? <RuntimeSwitch scope={scopeKey} /> : null), [hasCli, scopeKey]);
  const ui = useMemo<NoteUi>(
    () => ({ runtimeSwitch, onStatus, collapse, viewOnly }),
    [collapse, onStatus, runtimeSwitch, viewOnly],
  );

  const facts = useCallback(
    (): NotePromptFacts => ({
      title: note.title,
      noteId: note.id,
      linkId: readNoteFacts(bridgeRef.current.readSource()).id ?? null,
      relatedProject: related ? { id: related, name: relatedName ?? related } : null,
    }),
    [note.id, note.title, related, relatedName],
  );

  const noteFiles = useMemo<Pick<ClosedNoteReview, "load" | "save">>(
    () => ({
      load: () => dataRef.current.loadNote(note.id),
      save: (text, version) => dataRef.current.saveNote(note.id, text, version),
    }),
    [note.id],
  );

  const canCreate = Boolean(data.createNoteFrom);
  const deps = useMemo<NoteToolDeps>(() => {
    return {
      noteId: note.id,
      relatedProjectId: related,
      readSource: () => reviewedNoteSource(note.id, () => dataRef.current.loadNote(note.id)),
      propose: (edits) => proposeNoteEdits(note.id, edits),
      viewOnly: () => viewOnlyRef.current,
      notes: () => (shared ? NO_NOTES : dataRef.current.notes),
      projects: () => dataRef.current.projects ?? [],
      loadNote: (id) => dataRef.current.loadNote(id),
      searchNotes: (query, limit) => (shared ? Promise.resolve([]) : noteSearch(query, limit)),
      noteTags: () => (shared ? Promise.resolve([]) : listNoteTags()),
      linkIds,
      createNote: canCreate
        ? (draft) => {
            const create = dataRef.current.createNoteFrom;
            if (!create) return Promise.reject(new Error("Notes can't be created here."));
            return create(draft);
          }
        : undefined,
    };
  }, [canCreate, linkIds, note.id, related, shared]);

  const composer = useMemo<AssistantScopeComposer>(() => {
    const hidden = hiddenResearchActions(Boolean(latestRun), Boolean(related));
    const cliGroup: ModelSelectorGroup | null =
      cliAgents.length > 0
        ? {
            id: CLI_GROUP_ID,
            name: t(($) => $.notes.assistant.cliAgents),
            models: cliAgents.map((agent) => ({ id: agent.definition.id, name: agent.definition.name })),
          }
        : null;
    return {
      handle: composerHandle,
      placeholder: t(($) => $.notes.assistant.placeholder),
      textareaLabel: t(($) => $.notes.assistant.label),
      shellClassName: "[&_textarea]:pr-7",
      modelGroups: cliGroup ? [cliGroup] : undefined,
      onPickModelGroup: (providerId, modelId) => {
        if (providerId !== CLI_GROUP_ID) return false;
        useAcpSessionsStore.getState().setComposer(slot, { agentId: modelId });
        setScopeRuntime(scopeKey, "acp");
        return true;
      },
      slashCommands: (send) => {
        const passage = selectedPassage(note.id, bridgeRef.current.readSource());
        return RESEARCH_ACTIONS.filter(({ id }) => !hidden.has(id)).map(
          ({ id, icon }): ComposerCommand => ({
            id: `research:${id}`,
            label:
              actsOnPassage(id) && !passage
                ? t(($) => $.notes.prompt.wholeNote[id])
                : t(($) => $.notes.prompt.actions[id]),
            description: t(($) => $.notes.assistant.actionHint),
            icon,
            group: t(($) => $.notes.prompt.actionsGroup),
            action: () => send(researchTask(id, { latestRun, passage })),
          }),
        );
      },
      frame: glowPromptFrame(collapse),
    };
  }, [cliAgents, collapse, composerHandle, latestRun, note.id, related, scopeKey, setScopeRuntime, slot, t]);

  const mentions = useMemo(
    () => noteMentions(note.id, personalNotes, (id) => dataRef.current.loadNote(id)),
    [note.id, personalNotes],
  );

  const context = useCallback(
    async () =>
      noteContextBlock({
        facts: facts(),
        source: bridgeRef.current.readSource(),
        pending: bridgeRef.current.pending(),
        files: treeRef.current,
        notes: shared ? NO_NOTES : dataRef.current.notes,
        links: await linkIds().catch(() => new Map<string, string>()),
        memoryScope: scopeKey,
      }),
    [facts, linkIds, scopeKey, shared],
  );

  const modelMemory = useMemo(() => noteModelMemory(note.id), [note.id]);
  const scopeNote = useMemo(
    () => ({
      id: note.id,
      title: note.title,
      shared,
      home: homeProject && homePath ? { projectId: homeProject, path: homePath } : undefined,
    }),
    [homePath, homeProject, note.id, note.title, shared],
  );
  const scope = useMemo<AssistantScopeValue>(
    () => ({
      ...createNoteScope({
        note: scopeNote,
        facts,
        tree,
        currentTree: () => treeRef.current,
        deps,
        context,
        mentions,
        setRuntime: (next) => setScopeRuntime(scopeKey, next),
        composer,
        layout: NOTE_LAYOUT,
      }),
      modelMemory,
    }),
    [composer, context, deps, facts, mentions, modelMemory, scopeKey, scopeNote, setScopeRuntime, tree],
  );

  if (acp && viewOnly) return <ViewOnlyNotice onCollapse={collapse} />;
  if (acp) {
    return (
      <NoteAcpPanel
        note={note}
        bridge={bridge}
        onStatus={onStatus}
        onCollapse={collapse}
        runtimeSwitch={runtimeSwitch}
        tree={tree}
        relatedName={relatedName}
        files={noteFiles}
      />
    );
  }
  return (
    <NoteUiContext.Provider value={ui}>
      <AssistantScopeProvider value={scope}>
        <ChatCore />
      </AssistantScopeProvider>
    </NoteUiContext.Provider>
  );
}

function useScopeBusy(scopeKey: string, slot: string): boolean {
  const running = useSyncExternalStore(subscribeChatRun, () => activeChatRun(scopeKey) !== null);
  const hasChat = useChatsStore((state) => shownChats(state, scopeKey).activeId !== null);
  const agentRunning = useAcpSessionsStore((state) => {
    const id = state.activeByProject[slot];
    const status = id ? state.sessions[id]?.status : undefined;
    return status === "running" || status === "cancelling";
  });
  return running || hasChat || agentRunning;
}

export const NoteAssistant = memo(function NoteAssistant({
  note,
  bridge,
  shortcutScope,
  viewOnly = false,
  ref,
}: Readonly<NoteAssistantProps>) {
  const { t } = useTranslation(["notes", "ai"]);
  const scopeKey = noteScopeKey(note.id);
  const runtime = useAssistantRuntimeStore(useMemo(() => selectScopeRuntime(scopeKey), [scopeKey]));
  const dockRef = useRef<PromptDockHandle>(null);
  const composerHandle = useRef<ChatComposerHandle>(null);
  const bodyMounted = useRef(false);
  const [working, setWorking] = useState(false);
  const stopRef = useRef<() => void>(() => {});
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  const acp = runtime === "acp";
  const slot = noteAcpTarget(note.id, note.relatedProjectId).slot;
  const busy = useScopeBusy(scopeKey, slot);

  useEffect(() => holdScope(scopeKey), [scopeKey]);

  useEffect(
    () =>
      registerNoteEditor(note.id, {
        readSource: () => bridgeRef.current.readSource(),
        propose: (edits) => bridgeRef.current.propose(edits),
        pending: () => bridgeRef.current.pending(),
      }),
    [note.id],
  );

  const onStatus = useCallback((next: boolean, stop: () => void) => {
    stopRef.current = stop;
    setWorking(next);
  }, []);
  const stopTurn = useCallback(() => stopRef.current(), []);
  const collapse = useCallback(() => dockRef.current?.collapse(), []);
  const focusComposer = useCallback(() => composerHandle.current?.focus(), []);
  const stateKey = noteStateKey(note);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => dockRef.current?.expand(true),
      quote: (text) => {
        if (!text.trim()) return;
        if (viewOnly) {
          dockRef.current?.expand(false);
          return;
        }
        if (acp) {
          dockRef.current?.expand(false);
          const store = useAcpSessionsStore.getState();
          const selection: AcpSelection = {
            id: `note-quote-${Date.now()}`,
            path: null,
            text: text.trim().slice(0, QUOTE_CHARS),
            label: note.title,
          };
          store.setComposer(slot, { selections: [...(store.composers[slot]?.selections ?? []), selection] });
          return;
        }
        if (!bodyMounted.current) {
          const draft = builtinComposerId(stateKey);
          useComposerDrafts.getState().setText(draft, `${quoteBlock(text)}${draftText(draft)}`);
          dockRef.current?.expand(true);
          return;
        }
        dockRef.current?.expand(false);
        requestAnimationFrame(() => {
          const handle = composerHandle.current;
          handle?.focus();
          handle?.setCaret(0);
          handle?.insertText(quoteBlock(text));
        });
      },
    }),
    [acp, note.title, slot, stateKey, viewOnly],
  );

  const detail = acp ? t(($) => $.ai.runtime.cli) : t(($) => $.ai.runtime.builtIn);

  return (
    <PromptDock
      handle={dockRef}
      shortcutScope={shortcutScope}
      detail={detail}
      working={working}
      onStop={stopTurn}
      focusComposer={focusComposer}
      keepMounted={busy}
    >
      <ErrorBoundary surface="AI assistant" resetKey={runtime}>
        <div className="space-y-2">
          <NoteAssistantBody
            note={note}
            bridge={bridge}
            viewOnly={viewOnly}
            acp={acp}
            working={working}
            composerHandle={composerHandle}
            onStatus={onStatus}
            collapse={collapse}
            mounted={bodyMounted}
          />
        </div>
      </ErrorBoundary>
    </PromptDock>
  );
});
