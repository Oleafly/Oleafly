import {
  lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  useSyncExternalStore, type MutableRefObject, type RefObject,
} from "react";
import { Brain, Plus, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/empty";
import type { ChatComposerHandle } from "@/components/ai/composer/ChatComposer";
import { useResearchChatActions } from "@/components/ai/use-research-chat-actions";
import { MessageList, type RenderedMessage } from "@/components/ai/MessageList";
import { Shimmer } from "@/components/ai/chat-parts";
import { liveMessageFor } from "@/components/ai/live-message";
import {
  acpCommitTurn, acpDisconnect, acpElicitationRespond, acpError, acpPermission, acpReadiness,
  acpReconnect, acpUsable, type AcpAgentStatus, type AcpSession,
} from "@/lib/acp";
import { cn } from "@/lib/utils";
import {
  acpComposerId, attachAcpListeners, isDelegatedSession, useAcpSessionView, useAcpSessionsStore,
  type AcpPromptDraft,
} from "@/store/acp-sessions";
import { useComposerDrafts } from "@/store/composer-drafts";
import { AssistantHome } from "@/components/ai/home/AssistantHome";
import { AgentPickerRow, type AgentPickerEntry } from "@/components/ai/home/AgentPickerRow";
import { isSkillAvailable, useSkills, type SkillEntry } from "@/lib/skills";
import { cliResearchPresets, type ResearchPreset } from "@/lib/research-presets";
import { gitIsInitialized } from "@/lib/tauri";
import { TurnChangesCard } from "@/components/ai/turns/TurnChangesCard";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { AgentLogo } from "./AgentLogo";
import { BridgeInstallCard } from "./AgentReadiness";
import { TrustRequiredNotice } from "@/components/open-folder/TrustRequiredNotice";
import { PermissionCard } from "./PermissionCard";
import { useAcpConversation, useAcpHasMessages, useAcpMessages, type AcpConversation } from "./conversation";
import type { ResearchChatActions } from "@/lib/chat-activity";
import { Spinner } from "@/components/ui/spinner";
import { AcpComposer, acpDraftId, restoreDraft } from "./AcpComposer";
import { AcpComposerChips } from "./AcpComposerChips";
import { AcpControls } from "./AcpControls";
import { AcpSessionHeader } from "./AcpSessionHeader";
import { AcpSignIn } from "./AcpSignIn";
import { ElicitationCard } from "./ElicitationCard";

const CleanLibraryDialog = lazy(() =>
  import("@/components/layout/CleanLibraryDialog").then((module) => ({ default: module.CleanLibraryDialog })),
);

const EMPTY_PERMISSIONS: never[] = [];
const EMPTY_ELICITATIONS: never[] = [];

function canReconnect(session: AcpSession): boolean {
  if (isDelegatedSession(session)) return false;
  return !session.nativeSessionId || session.capabilities.resume || session.capabilities.loadSession;
}

export function AcpWorkspaceAssistant({ projectId }: Readonly<{ projectId: string }>) {
  const { t } = useTranslation(["common", "ai", "errors"]);
  const researchChatActions = useResearchChatActions(projectId);
  const catalog = useAcpSessionsStore((state) => state.catalog);
  const activeId = useAcpSessionsStore((state) => state.activeByProject[projectId] ?? null);
  const composer = useAcpSessionsStore((state) => state.composers[projectId]);
  const session = useAcpSessionView(activeId);
  const hasEarlier = useAcpSessionsStore((state) => (activeId ? (state.events[activeId]?.[0]?.sequence ?? 0) > 1 : false));
  const permissions = useAcpSessionsStore((state) => activeId ? state.permissions[activeId] ?? EMPTY_PERMISSIONS : EMPTY_PERMISSIONS);
  const elicitations = useAcpSessionsStore((state) => activeId ? state.elicitations[activeId] ?? EMPTY_ELICITATIONS : EMPTY_ELICITATIONS);
  const sending = useAcpSessionsStore((state) => (activeId ? (state.sending[activeId] ?? 0) > 0 : false));
  const agentId = composer?.agentId ?? null;
  const setComposer = useAcpSessionsStore((state) => state.setComposer);
  const error = useAcpSessionsStore((state) => state.errors[projectId] ?? null);
  // Why this conversation's last message did not go out (kept with it, not the project).
  const sessionError = useAcpSessionsStore((state) => (activeId ? state.sessionErrors[activeId] ?? null : null));
  const starting = useAcpSessionsStore((state) => state.starting[projectId] ?? false);
  const setProjectError = useAcpSessionsStore((state) => state.setError);
  const setError = useCallback(
    (message: string | null) => {
      setProjectError(projectId, message);
      // A new action clears what the open conversation last reported, as it clears the project's.
      if (message === null) {
        const shown = useAcpSessionsStore.getState().activeByProject[projectId];
        if (shown) useAcpSessionsStore.getState().setSessionError(shown, null);
      }
    },
    [projectId, setProjectError],
  );
  const [busy, setBusy] = useState(false);
  // Connecting to the agent (reconnect, sign in); the status pill says so, unlike other actions.
  const [connecting, setConnecting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const composerRef = useRef<ChatComposerHandle>(null);
  const running = session?.status === "running" || session?.status === "cancelling" || sending;
  const conversation = useAcpConversation(activeId, sending);
  const hasMessages = useAcpHasMessages(conversation);
  const selectedAgent = useMemo(
    () => catalog.find((agent) => agent.definition.id === agentId),
    [catalog, agentId],
  );
  const sessionAgent = useMemo(
    () => (session ? catalog.find((agent) => agent.definition.id === session.agentId) : undefined),
    [catalog, session],
  );
  const selectedReadiness = selectedAgent ? acpReadiness(selectedAgent) : null;
  const projectName = useFilesStore((state) => state.projectName);
  const skillsQuery = useSkills(projectId);
  const skills = skillsQuery.data ?? [];
  const [cleanLibraryOpen, setCleanLibraryOpen] = useState(false);
  const [gitRepository, setGitRepository] = useState(false);
  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => composerRef.current?.focus());
  }, []);
  // Sending brings the transcript down to the new message and the answer.
  const followSentMessage = useCallback(() => {
    nearBottomRef.current = true;
  }, []);
  // A picked skill travels with the next message as a chip; the agent gets its
  // instructions inline, so it works for agents without Oleafly's tools (Pi).
  const pickSkill = useCallback(
    (skill: SkillEntry) => {
      setComposer(projectId, { skill: { id: skill.id, name: skill.name } });
      focusComposer();
    },
    [focusComposer, projectId, setComposer],
  );
  const perform = useCallback(async (action: () => Promise<void>) => {
    setError(null); setBusy(true);
    try { await action(); } catch (error_) { setError(acpError(error_)); }
    finally { setBusy(false); }
  }, [setError]);
  const performConnecting = useCallback(async (action: () => Promise<void>) => {
    setConnecting(true);
    try { await perform(action); } finally { setConnecting(false); }
  }, [perform]);
  // A draft stays with what the user is writing for when a conversation starts from this panel.
  const carryDraft = (fromId: string) => {
    const state = useAcpSessionsStore.getState();
    const id = state.activeByProject[projectId];
    const started = id ? state.sessions[id] : undefined;
    if (started) useComposerDrafts.getState().moveDraft(fromId, acpDraftId(projectId, null, started));
  };
  const chooseAgent = (nextAgentId: string) => {
    const state = useAcpSessionsStore.getState();
    if (state.composers[projectId]?.agentId === nextAgentId) return;
    setComposer(projectId, { agentId: nextAgentId });
    const openId = state.activeByProject[projectId];
    const open = openId ? state.sessions[openId] : undefined;
    if (!openId || !open || open.agentId === nextAgentId) return;
    const ready = state.catalog.some(
      (value) => value.definition.id === nextAgentId && acpUsable(value),
    );
    void perform(async () => {
      if (ready) {
        const shownDraft = acpDraftId(projectId, open.agentId, open);
        try {
          await useAcpSessionsStore.getState().start(projectId, nextAgentId);
        } catch (error_) {
          setComposer(projectId, { agentId: open.agentId });
          throw error_;
        }
        carryDraft(shownDraft);
        return;
      }
      if (["ready", "auth_required"].includes(open.status)) {
        await acpDisconnect(projectId, openId);
      }
      useAcpSessionsStore.getState().setActive(projectId, null);
    });
  };

  const openSkillsSettings = useCallback(() => {
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("ai");
    settings.setSettingsScrollTarget("ai-skills");
    settings.setSettingsOpen(true);
  }, []);

  useEffect(() => {
    let current = true;
    setGitRepository(false);
    gitIsInitialized(projectId)
      .then((initialized) => { if (current) setGitRepository(initialized); })
      .catch(() => {});
    return () => { current = false; };
  }, [projectId]);

  useEffect(() => {
    let disposed = false;
    let detach: (() => void) | undefined;
    // The project's last error only: why a conversation's message did not go
    // out stays until the user does something there.
    setProjectError(projectId, null);
    void (async () => {
      detach = await attachAcpListeners();
      if (disposed) { detach(); return; }
      const state = useAcpSessionsStore.getState();
      await Promise.all([state.refreshCatalog(), state.loadProject(projectId)]);
      if (disposed) return;
      // Read after the waits: a conversation opened from History meanwhile stays shown.
      const id = useAcpSessionsStore.getState().activeByProject[projectId];
      if (id) await state.open(projectId, id);
    })().catch((error_: unknown) => { if (!disposed) setError(acpError(error_)); });
    const refresh = () => { void useAcpSessionsStore.getState().refreshCatalog().catch(() => {}); };
    window.addEventListener("oleafly:acp-catalog-changed", refresh);
    return () => {
      disposed = true;
      detach?.();
      window.removeEventListener("oleafly:acp-catalog-changed", refresh);
    };
  }, [projectId, setError, setProjectError]);

  useEffect(() => {
    if (!catalog.length) return;
    if (agentId && catalog.some((agent) => agent.definition.id === agentId)) return;
    const preferred = catalog.find((agent) => acpUsable(agent)) ?? catalog[0];
    // Text typed before the catalog loaded was kept under no agent.
    useComposerDrafts.getState().moveDraft(acpComposerId(projectId, null), acpComposerId(projectId, preferred.definition.id));
    setComposer(projectId, { agentId: preferred.definition.id });
  }, [catalog, agentId, projectId, setComposer]);

  const choosePermission = async (id: string, option: string | null) => {
    if (!activeId) return;
    setError(null);
    try { await acpPermission(projectId, activeId, id, option); }
    catch (error_) { setError(acpError(error_)); }
  };
  /** False when the answer did not reach the agent (the banner says why). */
  const answerQuestion = async (id: string, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => {
    if (!activeId) return false;
    setError(null);
    try {
      await acpElicitationRespond(projectId, activeId, id, action, content ?? null);
      return true;
    } catch (error_) {
      setError(acpError(error_));
      return false;
    }
  };

  const canStart = !!selectedAgent && acpUsable(selectedAgent) && !busy && !running;
  const start = () => void perform(async () => {
    if (!agentId) return;
    const shownDraft = acpDraftId(projectId, agentId, session);
    await useAcpSessionsStore.getState().start(projectId, agentId);
    carryDraft(shownDraft);
  });
  // Enter with no conversation starts one and sends the message when ready.
  const startWithDraft = useCallback((draft: AcpPromptDraft) => {
    if (!agentId) return;
    void perform(async () => {
      try {
        await useAcpSessionsStore.getState().startWithPrompt(projectId, agentId, draft);
      } catch (error_) {
        restoreDraft(projectId, acpDraftId(projectId, agentId, undefined), draft);
        throw error_;
      }
    });
  }, [agentId, perform, projectId]);

  // A preset fills the composer and starts a conversation when none is open.
  // It never sends: the researcher reads and adjusts the prompt first.
  const pickPreset = (preset: ResearchPreset) => {
    if (preset.action === "clean-library") {
      setCleanLibraryOpen(true);
      return;
    }
    const presetSkill = preset.skillId
      ? skills.find((entry) => entry.id === preset.skillId && entry.validation.status === "valid" && isSkillAvailable(entry))
      : undefined;
    // Added after what the user typed, which stays.
    const draftId = acpDraftId(projectId, agentId, session);
    const typed = useComposerDrafts.getState().drafts[draftId]?.text ?? "";
    let text = preset.prompt;
    if (typed.includes(preset.prompt)) text = typed;
    else if (typed.trim()) text = `${typed.trimEnd()}\n\n${preset.prompt}`;
    useComposerDrafts.getState().setText(draftId, text);
    setComposer(projectId, { skill: presetSkill ? { id: presetSkill.id, name: presetSkill.name } : null });
    focusComposer();
    if (!session && canStart && !starting) start();
  };
  const quickStarts = cliResearchPresets({ gitRepository }).map((preset) => ({
    id: preset.id,
    label: preset.label,
    icon: preset.icon,
    onSelect: () => pickPreset(preset),
  }));
  const agentNameOf = (id: string) => catalog.find((agent) => agent.definition.id === id)?.definition.name ?? id;
  const commitTurn = session && !isDelegatedSession(session) && gitRepository && !session.remote
    ? (turnId: string, paths: string[], message: string) =>
        acpCommitTurn(projectId, session.id, turnId, message, paths).then(() => undefined)
    : undefined;

  const homeSubtitle = () => {
    if (session?.status === "ready") {
      return t(($) => $.ai.acp.readySubtitle, {
        agent: selectedAgent?.definition.name ?? session.agentId,
      });
    }
    if (projectName) return t(($) => $.ai.acp.projectSubtitle, { project: projectName });
    return undefined;
  };

  const conversationBody = () =>
    hasMessages ? (
      <>
        <AcpConversationMessages
          conversation={conversation}
          activeId={activeId}
          projectId={projectId}
          actions={researchChatActions}
          scrollRef={scrollRef}
          nearBottomRef={nearBottomRef}
          onCommit={commitTurn}
          commitDefaultMessage={t(($) => $.ai.acp.commit.defaultMessage, {
            agent: session ? agentNameOf(session.agentId) : "",
          })}
        />
        {running && (
          <AcpThinkingRow conversation={conversation} scrollRef={scrollRef} nearBottomRef={nearBottomRef} />
        )}
      </>
    ) : (
      <AssistantHome
        before={
          agentId ? (
            <span className="flex size-16 items-center justify-center rounded-2xl border bg-background shadow-sm">
              <AgentLogo agentId={agentId} size={30} />
            </span>
          ) : null
        }
        skills={skills}
        showSkills={!!session}
        showQuickStarts
        quickStarts={quickStarts}
        onPickSkill={pickSkill}
        onOpenSkills={openSkillsSettings}
        quickStartTestId="acp-quick-start"
        subtitle={homeSubtitle()}
      />
    );

  const noResumeHint = (current: AcpSession) => {
    if (current.taskId) return t(($) => $.ai.acp.resumeTask);
    if (current.parentSessionId) return t(($) => $.ai.acp.delegatedConversation);
    return t(($) => $.ai.acp.noResume);
  };

  const conversationArea = () =>
    (busy || starting) && !hasMessages ? (
      <output
        data-testid="acp-connecting"
        className="mx-auto flex max-w-sm flex-col items-center gap-3 py-16 text-center"
      >
        <span className="flex size-12 items-center justify-center rounded-2xl border bg-background shadow-sm">
          {agentId ? (
            <AgentLogo agentId={agentId} size={22} />
          ) : (
            <Spinner size="lg" className="text-muted-foreground" />
          )}
        </span>
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Spinner size="sm" className="text-muted-foreground" />
          {t(($) => $.ai.acp.starting, {
            agent: selectedAgent?.definition.name ?? t(($) => $.ai.acp.startingFallback),
          })}
        </span>
        <span className="block text-xs text-muted-foreground">
          {t(($) => $.ai.acp.startingHint)}
        </span>
      </output>
    ) : (
      conversationBody()
    );

  const reconnect = () =>
    session &&
    void performConnecting(async () => {
      useAcpSessionsStore.getState().setSnapshot(await acpReconnect(projectId, session.id));
    });

  const statusBanners = () => (
    <>
      <TrustRequiredNotice
        projectId={projectId}
        reason={t(($) => $.errors.trust.agents)}
        className="mx-3 my-2"
      />
      {session?.remote && (
        <div
          data-testid="acp-remote-banner"
          className="mx-3 my-2 flex items-center gap-2 rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground"
        >
          <Server className="size-3.5 shrink-0" />
          {t(($) => $.ai.acp.remote.banner, { host: session.remote.host })}
        </div>
      )}
      {(error || sessionError || (session?.error && session.status !== "auth_required")) && (
        <ErrorState
          size="compact"
          className="mx-3 my-2 rounded-md border border-destructive/40 p-2"
          message={error ?? sessionError ?? session?.error}
        />
      )}
      {session?.status === "auth_required" && (
        <AcpSignIn
          projectId={projectId}
          session={session}
          agent={sessionAgent}
          busy={busy}
          perform={(action) => void performConnecting(action)}
        />
      )}
      {session && ["disconnected", "cancelled", "failed"].includes(session.status) && (
        <div className="border-t border-border p-3 text-xs">
          {canReconnect(session) ? (
            <Button variant="outline" size="sm" type="button" disabled={busy} onClick={reconnect}>
              {t(($) => $.ai.acp.reconnect)}
            </Button>
          ) : (
            <p>{noResumeHint(session)}</p>
          )}
        </div>
      )}
      {(permissions.length > 0 || elicitations.length > 0) && (
        <div className="max-h-[60vh] space-y-2 overflow-y-auto border-t border-border p-3">
          {elicitations.map((request) => (
            <ElicitationCard
              key={request.id}
              request={request}
              agentName={sessionAgent?.definition.name ?? session?.agentId ?? ""}
              onRespond={(action, content) => answerQuestion(request.id, action, content)}
            />
          ))}
          {permissions.map((request) => (
            <PermissionCard
              key={request.id}
              request={request}
              agentName={selectedAgent?.definition.name ?? session?.agentId}
              onChoose={choosePermission}
            />
          ))}
        </div>
      )}
    </>
  );

  const trackScroll = () => {
    const el = scrollRef.current;
    if (el) nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  const loadEarlier = () => {
    if (activeId) void perform(() => useAcpSessionsStore.getState().loadEarlier(projectId, activeId));
  };

  const leftControls = (
    <div className="ai-composer-controls-left no-scrollbar flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto overflow-y-hidden">
      {session ? (
        <SessionStatusPill
          session={session}
          agentName={agentNameOf(session.agentId)}
          connecting={connecting || starting}
        />
      ) : (
        <Button
          type="button"
          size="sm"
          data-testid="acp-start-conversation"
          className="h-7 shrink-0"
          disabled={!canStart || starting}
          onClick={start}
        >
          <Plus className="size-3.5" />
          {t(($) => $.ai.acp.startConversation, {
            agent:
              selectedAgent?.definition.name ?? t(($) => $.ai.acp.startConversationFallback),
          })}
        </Button>
      )}
    </div>
  );

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-sidebar text-foreground"
      aria-label={t(($) => $.ai.acp.assistantAriaLabel)}
      data-composer-panel
    >
      {session && !isDelegatedSession(session) && (
        <AcpSessionHeader
          projectId={projectId}
          session={session}
          agentName={agentNameOf(session.agentId)}
          busy={busy}
          perform={(action) => void perform(action)}
        />
      )}
      <div
        ref={scrollRef}
        data-testid="acp-transcript"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        onScroll={trackScroll}
      >
        {hasEarlier && (
          <Button
            variant="outline"
            size="sm"
            type="button"
            className="mb-3 w-full"
            disabled={busy}
            onClick={loadEarlier}
          >
            {t(($) => $.ai.acp.loadEarlier)}
          </Button>
        )}
        {conversationArea()}
      </div>
      {statusBanners()}
      {selectedAgent && selectedReadiness !== "ready" && (
        <div data-testid="acp-readiness-card" className="px-3 pb-2 pt-1">
          <BridgeInstallCard agent={selectedAgent} onError={setError} />
        </div>
      )}
      {/* The agent is settled once the conversation has a message; "+" starts another. */}
      {!hasMessages && (
        <div className="px-3 pb-1.5 pt-1">
          <AgentPickerRow
            agents={agentRoster(catalog)}
            selectedId={agentId}
            disabled={running || busy || starting}
            onSelect={chooseAgent}
          />
        </div>
      )}
      <AcpComposerChips projectId={projectId} session={session} />
      <div className="p-3 pt-1">
        <AcpComposer
          ref={composerRef}
          projectId={projectId}
          session={session}
          agent={selectedAgent}
          agentId={agentId}
          onStart={startWithDraft}
          onSend={followSentMessage}
          onError={setError}
          leftControls={leftControls}
          trailingControls={session ? (
            <AcpControls projectId={projectId} session={session} disabled={busy || running} onError={setError} />
          ) : null}
        />
      </div>
      {cleanLibraryOpen && (
        <Suspense fallback={null}>
          <CleanLibraryDialog open onClose={() => setCleanLibraryOpen(false)} />
        </Suspense>
      )}
    </section>
  );
}

const AcpConversationMessages = memo(function AcpConversationMessages({
  conversation,
  activeId,
  projectId,
  actions,
  scrollRef,
  nearBottomRef,
  onCommit,
  commitDefaultMessage,
}: Readonly<{
  conversation: AcpConversation;
  activeId: string | null;
  projectId: string;
  actions: ResearchChatActions;
  scrollRef: RefObject<HTMLDivElement | null>;
  nearBottomRef: MutableRefObject<boolean>;
  onCommit?: (turnId: string, paths: string[], message: string) => Promise<void>;
  commitDefaultMessage: string;
}>) {
  const messages = useAcpMessages(conversation);
  const shownSessionRef = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (shownSessionRef.current !== activeId) {
      shownSessionRef.current = activeId;
      nearBottomRef.current = true;
    }
    const element = scrollRef.current;
    if (messages.length && activeId && nearBottomRef.current && element) element.scrollTop = element.scrollHeight;
  }, [activeId, messages, nearBottomRef, scrollRef]);
  const firstUnavailableKey = messages.find((entry) => entry.msg.turnChanges?.unavailable)?.key ?? null;
  const renderTurnChanges = useCallback(
    ({ key, msg }: RenderedMessage) =>
      msg.turnChanges ? (
        <TurnChangesCard
          projectId={projectId}
          changes={msg.turnChanges}
          showUnavailable={key === firstUnavailableKey}
          className="mt-1.5"
          onCommit={onCommit && msg.turnId ? (paths, message) => onCommit(msg.turnId ?? "", paths, message) : undefined}
          commitDefaultMessage={commitDefaultMessage}
        />
      ) : null,
    [commitDefaultMessage, firstUnavailableKey, onCommit, projectId],
  );
  return (
    <MessageList
      actions={actions}
      messages={messages}
      live={conversation.live}
      chatId={activeId}
      scrollRef={scrollRef}
      nearBottomRef={nearBottomRef}
      renderExtras={renderTurnChanges}
    />
  );
});

/** "Thinking…" while the agent works, as the Oleafly Agent shows it. A live
 *  reasoning block shows its own, so there is one indicator at a time. */
const AcpThinkingRow = memo(function AcpThinkingRow({
  conversation,
  scrollRef,
  nearBottomRef,
}: Readonly<{
  conversation: AcpConversation;
  scrollRef: RefObject<HTMLDivElement | null>;
  nearBottomRef: MutableRefObject<boolean>;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const messages = useAcpMessages(conversation);
  const live = useSyncExternalStore(conversation.live.subscribe, conversation.live.get, conversation.live.get);
  const last = messages.at(-1)?.msg;
  const tail = last ? liveMessageFor(last, live) : undefined;
  const reasoningLive = tail?.reasoningBlocks?.some((block) => block.ms === undefined) ?? false;
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!reasoningLive && nearBottomRef.current && element) element.scrollTop = element.scrollHeight;
  }, [nearBottomRef, reasoningLive, scrollRef]);
  if (reasoningLive) return null;
  return (
    <div data-testid="acp-thinking" className="max-w-[85%] text-xs">
      <div className="flex w-full items-center gap-2 py-1 text-sm text-muted-foreground">
        <Brain className="ai-shimmer-icon size-3.5 shrink-0" />
        <Shimmer text={t(($) => $.ai.chat.reasoning.thinking)} />
      </div>
    </div>
  );
});

const STATUS_TONE: Record<AcpSession["status"], BadgeVariant> = {
  connecting: "primaryGhost",
  auth_required: "warning",
  ready: "success",
  running: "primaryGhost",
  cancelling: "warning",
  cancelled: "muted",
  disconnected: "muted",
  failed: "destructive",
};

/** The statuses in which the agent is busy: their dot pulses, unless motion is reduced. */
const PULSING_STATUSES: ReadonlySet<AcpSession["status"]> = new Set(["connecting", "running", "cancelling"]);

function sessionStatusLabel(status: AcpSession["status"]): string {
  switch (status) {
    case "connecting":
      return i18n.t(($) => $.ai.acp.sessionStatus.connecting);
    case "auth_required":
      return i18n.t(($) => $.ai.acp.sessionStatus.authRequired);
    case "ready":
      return i18n.t(($) => $.ai.acp.sessionStatus.ready);
    case "running":
      return i18n.t(($) => $.ai.acp.sessionStatus.running);
    case "cancelling":
      return i18n.t(($) => $.ai.acp.sessionStatus.cancelling);
    case "cancelled":
      return i18n.t(($) => $.ai.acp.sessionStatus.cancelled);
    case "disconnected":
      return i18n.t(($) => $.ai.acp.sessionStatus.disconnected);
    default:
      return i18n.t(($) => $.ai.acp.sessionStatus.failed);
  }
}

function SessionStatusPill({ session, agentName, connecting }: Readonly<{ session: AcpSession; agentName: string; connecting: boolean }>) {
  const { t } = useTranslation(["common", "ai"]);
  let text: string;
  if (connecting) {
    text = t(($) => $.ai.acp.connecting);
  } else if (session.status === "ready") {
    text = agentName;
  } else {
    text = t(($) => $.ai.acp.sessionStatusPill, {
      agent: agentName,
      status: sessionStatusLabel(session.status),
    });
  }
  return (
    <Badge
      variant={connecting ? "outline" : STATUS_TONE[session.status]}
      size="sm"
      data-testid="acp-session-status"
      data-status={session.status}
      className="h-6 max-w-44 gap-1.5 px-2"
    >
      {connecting ? (
        <Spinner className="size-2.5" />
      ) : (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full bg-current",
            PULSING_STATUSES.has(session.status) && "motion-safe:animate-pulse",
          )}
        />
      )}
      <span className="truncate">{text}</span>
      {/* Ready shows as the green dot alone; screen readers still hear it. */}
      {!connecting && session.status === "ready" && (
        <span className="sr-only"> {sessionStatusLabel(session.status)}</span>
      )}
    </Badge>
  );
}

function rosterHint(readiness: ReturnType<typeof acpReadiness>): string {
  if (readiness === "bridge-missing") return i18n.t(($) => $.ai.acp.roster.bridgeMissing);
  if (readiness === "cli-missing") return i18n.t(($) => $.ai.acp.roster.cliMissing);
  return i18n.t(($) => $.ai.acp.roster.unavailable);
}

/** The agents in the catalog, ready ones selectable. */
export function agentRoster(catalog: AcpAgentStatus[]): AgentPickerEntry[] {
  return catalog.map((agent) => {
    const readiness = acpReadiness(agent);
    return {
      id: agent.definition.id,
      name: agent.definition.name,
      available: readiness === "ready",
      hint: rosterHint(readiness),
    };
  });
}
