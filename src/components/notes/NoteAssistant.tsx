import { ChevronDown, ChevronUp, History, MessagesSquare, Plus } from "lucide-react";
import { createContext, forwardRef, memo, Suspense, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
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
import { listFiles, listNoteTags, noteHeads, noteSearch, type FileEntry } from "@/lib/tauri";
import { useAgentMemoryStore } from "@/store/agent-memory";
import { useAgentTodoStore } from "@/store/agent-todos";
import { useAcpSessionsStore, type AcpSelection } from "@/store/acp-sessions";
import { selectScopeRuntime, useAssistantRuntimeStore } from "@/store/assistant-runtime";
import { useChatsStore } from "@/store/chats";
import { CollapsePromptButton, GlowRing, PromptDock, type PromptDockHandle } from "./AgentPrompt";
import { noteAcpTarget, noteContextSelection, reviewAfterClose, useNoteAcpEdits, type ClosedNoteReview } from "./note-acp";
import { useNoteAcpReadOnly, useNoteAcpWriteGuard } from "./note-acp-read-only";
import { hiddenResearchActions, researchTask, type NotePromptFacts } from "./note-assistant-prompt";
import { createNoteScope, noteContextBlock, noteMentions, noteScopeKey } from "./note-assistant-scope";
import type { NoteToolDeps } from "./note-assistant-tools";
import type { NoteEdit } from "./note-edits";
import { readNoteFacts } from "./note-file";
import { noteModelMemory } from "./note-model-memory";
import {
  addPendingBatch,
  noteEditorLink,
  pendingBatches,
  registerNoteEditor,
  withPendingEdits,
} from "./note-pending-suggestions";
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
}

interface NoteUi {
  runtimeSwitch: ReactNode;
  onStatus: (working: boolean, stop: () => void) => void;
  collapse: () => void;
}

const NoteUiContext = createContext<NoteUi | null>(null);
const CLI_GROUP_ID = "note-cli-agents";
const QUOTE_CHARS = 2_000;
const LINK_CACHE_MS = 10_000;
const NO_FILES: FileEntry[] = [];

const mountedScopes = new Map<string, number>();

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
    if (!activeChatRun(scope)) {
      forgetScope(scope);
      return;
    }
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

function useLinkIds(): () => Promise<ReadonlyMap<string, string>> {
  const cache = useRef<{ at: number; links: Promise<ReadonlyMap<string, string>> } | null>(null);
  return useCallback(() => {
    const cached = cache.current;
    if (cached && Date.now() - cached.at < LINK_CACHE_MS) return cached.links;
    const links = noteHeads().then((heads) => {
      const map = new Map<string, string>();
      for (const head of heads) {
        const id = readNoteFacts(head.head).id;
        if (id) map.set(head.id, id);
      }
      return map as ReadonlyMap<string, string>;
    });
    cache.current = { at: Date.now(), links };
    links.catch(() => {
      if (cache.current?.links === links) cache.current = null;
    });
    return links;
  }, []);
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
          <div className="flex items-center gap-1 border-b px-1.5 py-1">
            <div className="ml-auto flex items-center gap-1">
              {header}
              <Tooltip label={t(($) => $.notes.assistant.foldConversation)}>
                <button
                  type="button"
                  aria-label={t(($) => $.notes.assistant.foldConversation)}
                  onClick={() => setOpen(false)}
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent"
                >
                  <ChevronDown aria-hidden className="size-3.5" />
                </button>
              </Tooltip>
            </div>
          </div>
          <div
            ref={parts.scrollRef}
            onScroll={parts.onScroll}
            data-note-thread
            className="max-h-[45vh] overflow-y-auto overscroll-contain px-3 py-3"
          >
            {parts.messages}
          </div>
        </section>
      )}
      {parts.hasMessages && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="flex w-full items-center gap-2 rounded-xl border bg-card px-3 py-2 text-left text-xs text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent"
        >
          <MessagesSquare aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t(($) => $.notes.assistant.showConversation)}</span>
          {working && <Spinner size="xs" />}
          <ChevronUp aria-hidden className="size-3.5 shrink-0" />
        </button>
      )}
      {!parts.hasMessages && (parts.chatCount > 0 || ui?.runtimeSwitch) && (
        <div className="flex justify-end">{header}</div>
      )}
      {parts.footer}
      {parts.setup ? (
        <div className="relative">
          {parts.setup}
          {ui && <CollapsePromptButton onCollapse={ui.collapse} />}
        </div>
      ) : (
        parts.composer
      )}
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
  const extraSelections = useCallback(
    (): readonly AcpSelection[] => [noteContextSelection(note.title, bridge.readSource(), target)],
    [bridge, note.title, target],
  );
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

export const NoteAssistant = memo(forwardRef<NoteAssistantHandle, NoteAssistantProps>(function NoteAssistant(
  { note, bridge, shortcutScope },
  ref,
) {
  const { t } = useTranslation(["notes", "ai"]);
  const data = useNotesData();
  const scopeKey = noteScopeKey(note.id);
  const runtime = useAssistantRuntimeStore(useMemo(() => selectScopeRuntime(scopeKey), [scopeKey]));
  const setScopeRuntime = useAssistantRuntimeStore((state) => state.setScopeRuntime);
  const catalog = useAcpSessionsStore((state) => state.catalog);
  const cliAgents = useMemo(() => catalog.filter(acpUsable), [catalog]);
  const dockRef = useRef<PromptDockHandle>(null);
  const composerHandle = useRef<ChatComposerHandle>(null);
  const [working, setWorking] = useState(false);
  const stopRef = useRef<() => void>(() => {});
  const [tree, setTree] = useState<readonly FileEntry[]>(NO_FILES);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  const dataRef = useRef(data);
  dataRef.current = data;
  const linkIds = useLinkIds();
  const related = note.relatedProjectId ?? null;
  const relatedName = related ? (data.projects?.find((project) => project.id === related)?.name ?? note.project) : null;
  const latestRun = data.latestRun?.(note.id) ?? null;
  const acp = runtime === "acp";
  const slot = noteAcpTarget(note.id, related).slot;

  useEffect(() => {
    void useAcpSessionsStore
      .getState()
      .refreshCatalog()
      .catch(() => false);
  }, []);

  const folder = note.home?.projectId ?? note.id;
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

  const hasCli = cliAgents.length > 0;
  const runtimeSwitch = useMemo(() => (hasCli ? <RuntimeSwitch scope={scopeKey} /> : null), [hasCli, scopeKey]);
  const collapse = useCallback(() => dockRef.current?.collapse(), []);
  const ui = useMemo<NoteUi>(
    () => ({ runtimeSwitch, onStatus, collapse }),
    [collapse, onStatus, runtimeSwitch],
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
      readSource: () =>
        noteEditorLink(note.id)?.readSource() ??
        dataRef.current.loadNote(note.id).then((saved) => withPendingEdits(saved.text, pendingBatches(note.id))),
      propose: (edits) => {
        const open = noteEditorLink(note.id);
        if (open) return open.propose(edits);
        addPendingBatch(note.id, edits);
        return edits.length;
      },
      notes: () => dataRef.current.notes,
      projects: () => dataRef.current.projects ?? [],
      loadNote: (id) => dataRef.current.loadNote(id),
      searchNotes: (query, limit) => noteSearch(query, limit),
      noteTags: () => listNoteTags(),
      linkIds,
      createNote: canCreate
        ? async (draft) => {
            const create = dataRef.current.createNoteFrom;
            if (!create) throw new Error("Notes can't be created here.");
            return create(draft);
          }
        : undefined,
    };
  }, [canCreate, linkIds, note.id, related]);

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
      slashCommands: (send) =>
        RESEARCH_ACTIONS.filter(({ id }) => !hidden.has(id)).map(
          ({ id, icon }): ComposerCommand => ({
            id: `research:${id}`,
            label: t(($) => $.notes.prompt.actions[id]),
            description: t(($) => $.notes.assistant.actionHint),
            icon,
            group: t(($) => $.notes.prompt.actionsGroup),
            action: () => send(researchTask(id, latestRun)),
          }),
        ),
      frame: (node, working) => (
        <div data-working={working || undefined} className="note-prompt-glow relative isolate rounded-[1.375rem]">
          <GlowRing />
          {node}
          <CollapsePromptButton onCollapse={collapse} />
        </div>
      ),
    };
  }, [cliAgents, collapse, latestRun, related, scopeKey, setScopeRuntime, slot, t]);

  const mentions = useMemo(
    () => noteMentions(note.id, data.notes, (id) => dataRef.current.loadNote(id)),
    [data.notes, note.id],
  );

  const context = useCallback(
    async () =>
      noteContextBlock({
        facts: facts(),
        source: bridgeRef.current.readSource(),
        pending: bridgeRef.current.pending(),
        files: treeRef.current,
        notes: dataRef.current.notes,
        links: await linkIds().catch(() => new Map<string, string>()),
        memoryScope: scopeKey,
      }),
    [facts, linkIds, scopeKey],
  );

  const modelMemory = useMemo(() => noteModelMemory(note.id), [note.id]);
  const scope = useMemo<AssistantScopeValue>(
    () => ({
      ...createNoteScope({
        note,
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
    [composer, context, deps, facts, mentions, modelMemory, note, scopeKey, setScopeRuntime, tree],
  );

  const focusComposer = useCallback(() => composerHandle.current?.focus(), []);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => dockRef.current?.expand(true),
      quote: (text) => {
        if (!text.trim()) return;
        dockRef.current?.expand(false);
        if (acp) {
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
        requestAnimationFrame(() => {
          const handle = composerHandle.current;
          handle?.focus();
          handle?.setCaret(0);
          handle?.insertText(quoteBlock(text));
        });
      },
    }),
    [acp, note.title, slot],
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
    >
      <ErrorBoundary surface="AI assistant" resetKey={runtime}>
        <div className="space-y-2">
          {acp ? (
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
          ) : (
            <NoteUiContext.Provider value={ui}>
              <AssistantScopeProvider value={scope}>
                <ChatCore />
              </AssistantScopeProvider>
            </NoteUiContext.Provider>
          )}
        </div>
      </ErrorBoundary>
    </PromptDock>
  );
}));
