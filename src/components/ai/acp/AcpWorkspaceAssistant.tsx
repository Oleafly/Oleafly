import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Loader2, Paperclip, Plus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useResearchChatActions } from "@/components/ai/use-research-chat-actions";
import { MessageList } from "@/components/ai/MessageList";
import {
  acpAuthenticate, acpCancel, acpDisconnect, acpError, acpPermission, acpPrompt, acpReadiness,
  acpReconnect, acpSetModel, type AcpAgentStatus, type AcpImage, type AcpSession,
} from "@/lib/acp";
import { cn } from "@/lib/utils";
import { attachAcpListeners, isDelegatedSession, useAcpSessionsStore, type AcpAttachment } from "@/store/acp-sessions";
import { AssistantHome } from "@/components/ai/home/AssistantHome";
import { AgentPickerRow, type AgentPickerEntry } from "@/components/ai/home/AgentPickerRow";
import { openCliAgentSettings } from "@/components/ai/AssistantShellAcpActions";
import { useSkills, type SkillEntry } from "@/lib/skills";
import { useSettingsStore } from "@/store/settings";
import { AgentLogo } from "./AgentLogo";
import { AGENT_MARK_IDS } from "./agent-marks";
import { BridgeInstallCard } from "./AgentReadiness";
import { PermissionCard } from "./PermissionCard";
import { createAcpProjector } from "./projection";

const EMPTY_EVENTS: never[] = [];
const EMPTY_PERMISSIONS: never[] = [];
const EMPTY_IMAGES: AcpAttachment[] = [];

function canReconnect(session: AcpSession): boolean {
  if (isDelegatedSession(session)) return false;
  return !session.nativeSessionId || session.capabilities.resume || session.capabilities.loadSession;
}

export function AcpWorkspaceAssistant({ projectId }: { projectId: string }) {
  const researchChatActions = useResearchChatActions(projectId);
  const catalog = useAcpSessionsStore((state) => state.catalog);
  const activeId = useAcpSessionsStore((state) => state.activeByProject[projectId] ?? null);
  const allSessions = useAcpSessionsStore((state) => state.sessions);
  const composer = useAcpSessionsStore((state) => state.composers[projectId]);
  const session = activeId ? allSessions[activeId] : undefined;
  const events = useAcpSessionsStore((state) => activeId ? state.events[activeId] ?? EMPTY_EVENTS : EMPTY_EVENTS);
  const permissions = useAcpSessionsStore((state) => activeId ? state.permissions[activeId] ?? EMPTY_PERMISSIONS : EMPTY_PERMISSIONS);
  const agentId = composer?.agentId ?? null;
  const draft = composer?.draft ?? "";
  const images = composer?.images ?? EMPTY_IMAGES;
  const setComposer = useAcpSessionsStore((state) => state.setComposer);
  const error = useAcpSessionsStore((state) => state.errors[projectId] ?? null);
  const starting = useAcpSessionsStore((state) => state.starting[projectId] ?? false);
  const setProjectError = useAcpSessionsStore((state) => state.setError);
  const setError = useCallback(
    (message: string | null) => setProjectError(projectId, message),
    [projectId, setProjectError],
  );
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const shownSessionRef = useRef<string | null>(activeId);
  const fileRef = useRef<HTMLInputElement>(null);
  const running = session?.status === "running" || session?.status === "cancelling" || sending;
  const projectEvents = useMemo(() => createAcpProjector(), []);
  const messages = useMemo(() => projectEvents(events, running), [events, running, projectEvents]);
  const selectedAgent = useMemo(
    () => catalog.find((agent) => agent.definition.id === agentId),
    [catalog, agentId],
  );
  const selectedReadiness = selectedAgent ? acpReadiness(selectedAgent) : null;
  const skillsQuery = useSkills(projectId);
  const skills = skillsQuery.data ?? [];
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const setDraft = useCallback((value: string) => setComposer(projectId, { draft: value }), [projectId, setComposer]);
  const pickSkill = useCallback(
    (skill: SkillEntry) => {
      setComposer(projectId, { draft: `Use the "${skill.name}" skill: ` });
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      });
    },
    [projectId, setComposer],
  );
  const chooseAgent = (nextAgentId: string) => {
    const state = useAcpSessionsStore.getState();
    if (state.composers[projectId]?.agentId === nextAgentId) return;
    setComposer(projectId, { agentId: nextAgentId });
    const openId = state.activeByProject[projectId];
    const open = openId ? state.sessions[openId] : undefined;
    if (!openId || !open || open.agentId === nextAgentId) return;
    const ready = state.catalog.some(
      (value) => value.definition.id === nextAgentId && value.installed,
    );
    void perform(async () => {
      if (ready) {
        await useAcpSessionsStore.getState().start(projectId, nextAgentId);
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
  const setImages = useCallback((value: AcpAttachment[]) => setComposer(projectId, { images: value }), [projectId, setComposer]);

  useEffect(() => {
    let disposed = false;
    let detach: (() => void) | undefined;
    setError(null);
    void (async () => {
      detach = await attachAcpListeners();
      if (disposed) { detach(); return; }
      const state = useAcpSessionsStore.getState();
      await Promise.all([state.refreshCatalog(), state.loadProject(projectId)]);
      const id = state.activeByProject[projectId];
      if (id) await state.open(projectId, id);
    })().catch((value: unknown) => { if (!disposed) setError(acpError(value)); });
    const refresh = () => { void useAcpSessionsStore.getState().refreshCatalog().catch(() => {}); };
    window.addEventListener("oleafly:acp-catalog-changed", refresh);
    return () => {
      disposed = true;
      detach?.();
      window.removeEventListener("oleafly:acp-catalog-changed", refresh);
    };
  }, [projectId, setError]);

  useEffect(() => {
    if (!catalog.length) return;
    if (agentId && catalog.some((agent) => agent.definition.id === agentId)) return;
    const preferred = catalog.find((agent) => agent.installed) ?? catalog[0];
    setComposer(projectId, { agentId: preferred.definition.id });
  }, [catalog, agentId, projectId, setComposer]);

  useLayoutEffect(() => {
    if (shownSessionRef.current !== activeId) {
      shownSessionRef.current = activeId;
      nearBottomRef.current = true;
    }
    if (messages.length && activeId && nearBottomRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, activeId]);

  const perform = async (action: () => Promise<void>) => {
    setError(null); setBusy(true);
    try { await action(); } catch (value) { setError(acpError(value)); }
    finally { setBusy(false); }
  };
  const send = async () => {
    if (!activeId || session?.status !== "ready" || sending || (!draft.trim() && images.length === 0)) return;
    const message = draft;
    const attachments = images;
    const prompt = [{ type: "text", text: message }, ...attachments.map(({ image }) => ({ type: "image", ...image }))];
    if (new TextEncoder().encode(message).byteLength > 256 * 1024 || new TextEncoder().encode(JSON.stringify({ sessionId: session.nativeSessionId, prompt })).byteLength > 1024 * 1024 - 1024) {
      setError("This message and its images are too large. Shorten the message or remove an image.");
      return;
    }
    const beforeSequence = session.lastSequence;
    const clearComposer = () => setComposer(projectId, { draft: "", images: [] });
    setError(null); setSending(true); nearBottomRef.current = true;
    try {
      useAcpSessionsStore.getState().setSnapshot(await acpPrompt(projectId, activeId, message, attachments.map((value) => value.image)));
      clearComposer();
    } catch (value) {
      setError(acpError(value));
      await useAcpSessionsStore.getState().resync(projectId, activeId).catch(() => {});
      if (useAcpSessionsStore.getState().events[activeId]?.some((event) => event.kind === "user_message" && event.sequence > beforeSequence)) clearComposer();
    } finally { setSending(false); }
  };
  const choosePermission = async (id: string, option: string | null) => {
    if (!activeId) return;
    setError(null);
    try { await acpPermission(projectId, activeId, id, option); }
    catch (value) { setError(acpError(value)); }
  };
  const addImage = (file: File) => {
    if (file.size > 480 * 1024 || images.length >= 4) {
      setError("Choose an image smaller than 480 KiB. You can attach up to four images.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result).split(",")[1];
      if (!data) return;
      const image: AcpImage = { mimeType: file.type, data };
      setComposer(projectId, {
        images: [...useAcpSessionsStore.getState().composers[projectId]?.images ?? [], { id: crypto.randomUUID(), name: file.name, image }],
      });
    };
    reader.onerror = () => setError("The image could not be read.");
    reader.readAsDataURL(file);
  };

  const canSend = session?.status === "ready" && !busy && (!!draft.trim() || images.length > 0);
  const composerDisabled = session?.status !== "ready" || sending;
  const canStart = !!selectedAgent?.installed && !busy && !running;
  const start = () => void perform(async () => {
    if (agentId) await useAcpSessionsStore.getState().start(projectId, agentId);
  });

  return <section className="flex h-full min-h-0 flex-col bg-sidebar text-foreground" aria-label="CLI agent assistant">
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" onScroll={() => { const el = scrollRef.current; if (el) nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {events[0]?.sequence > 1 && <Button variant="outline" size="sm" type="button" className="mb-3 w-full" disabled={busy} onClick={() => { if (activeId) void perform(() => useAcpSessionsStore.getState().loadEarlier(projectId, activeId)); }}>Load earlier activity</Button>}
      {(busy || starting) && messages.length === 0 ? (
        <div
          data-testid="acp-connecting"
          role="status"
          className="mx-auto flex max-w-sm flex-col items-center gap-3 py-16 text-center"
        >
          <span className="flex size-12 items-center justify-center rounded-2xl border bg-background shadow-sm">
            {agentId ? (
              <AgentLogo agentId={agentId} size={22} />
            ) : (
              <Loader2 aria-hidden className="size-5 animate-spin text-muted-foreground" />
            )}
          </span>
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Loader2 aria-hidden className="size-3.5 animate-spin text-muted-foreground" />
            Starting {selectedAgent?.definition.name ?? "the agent"}
          </p>
          <p className="text-xs text-muted-foreground">
            The agent's command line tool is launching. This takes a few seconds the first time.
          </p>
        </div>
      ) : messages.length > 0 ? (
        <MessageList actions={researchChatActions} messages={messages} chatId={activeId} scrollRef={scrollRef} nearBottomRef={nearBottomRef} />
      ) : (
        <AssistantHome
          skills={skills}
          onPickSkill={pickSkill}
          onOpenSkills={openSkillsSettings}
          quickStartTestId="acp-quick-start"
          subtitle={
            session?.status === "ready"
              ? `${selectedAgent?.definition.name ?? session.agentId} is ready in this project`
              : undefined
          }
        />
      )}
    </div>
    {(error || session?.error) && <div role="alert" className="mx-3 my-2 rounded-md border border-destructive/40 p-2 text-xs text-destructive">{error ?? session?.error}</div>}
    {session?.status === "auth_required" && <div className="space-y-2 border-t border-border p-3 text-xs">
      <p>{catalog.find((agent) => agent.definition.id === session.agentId)?.signInHint ?? "Sign in using this agent's CLI, then reconnect."}</p>
      <div className="flex flex-wrap gap-2">
        {session.authMethods.map((method) => <Button variant="outline" size="sm" key={method.id} type="button" disabled={busy} onClick={() => void perform(async () => { useAcpSessionsStore.getState().setSnapshot(await acpAuthenticate(projectId, session.id, method.id)); })}>{method.name}</Button>)}
        <Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => void perform(async () => { await acpDisconnect(projectId, session.id); useAcpSessionsStore.getState().setSnapshot(await acpReconnect(projectId, session.id)); })}>Reconnect after sign-in</Button>
      </div>
    </div>}
    {session && ["disconnected", "cancelled", "failed"].includes(session.status) && <div className="border-t border-border p-3 text-xs">
      {canReconnect(session) ? <Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => void perform(async () => { useAcpSessionsStore.getState().setSnapshot(await acpReconnect(projectId, session.id)); })}>Reconnect to conversation</Button> : <p>{session.taskId ? "Open the research task to resume this work." : session.parentSessionId ? "This conversation belongs to a delegated agent run." : "This agent cannot resume saved conversations. Start a new conversation when you are ready."}</p>}
    </div>}
    {permissions.length > 0 && <div className="max-h-64 space-y-2 overflow-y-auto border-t border-border p-3">
      {permissions.map((request) => <PermissionCard key={request.id} request={request} agentName={selectedAgent?.definition.name ?? session?.agentId} onChoose={choosePermission} />)}
    </div>}
    {selectedAgent && selectedReadiness !== "ready" && (
      <div data-testid="acp-readiness-card" className="px-3 pb-2 pt-1">
        <BridgeInstallCard agent={selectedAgent} onError={setError} />
      </div>
    )}
    <div className="px-3 pb-1.5 pt-1">
      <AgentPickerRow
        agents={agentRoster(catalog)}
        selectedId={agentId}
        disabled={running || busy || starting}
        onSelect={(id) => {
          if (catalog.some((agent) => agent.definition.id === id)) chooseAgent(id);
          else openCliAgentSettings();
        }}
      />
    </div>
    <form className="p-3 pt-1" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {images.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">
        {images.map((value, index) => (
          <Button key={value.id} type="button" variant="outline" size="xs" aria-label={`Remove ${value.name}`} onClick={() => setImages(images.filter((_, position) => position !== index))}>
            {value.name} <X className="size-3" />
          </Button>
        ))}
      </div>}
      <div className="relative rounded-[1.375rem] border bg-card px-3 pb-2 pt-2.5 shadow-sm transition-colors focus-within:border-ring">
        <Input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) addImage(file); }}
        />
        <Textarea
          ref={textareaRef}
          aria-label="Message CLI agent"
          placeholder={session?.status === "ready" ? "Ask the agent to work on this project" : "Start or reconnect a conversation to send a message"}
          value={draft}
          rows={1}
          disabled={composerDisabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
          }}
          className="max-h-56 min-h-[32px] w-full resize-none overflow-y-auto rounded-md border-0 bg-transparent px-0.5 text-sm shadow-none outline-none placeholder:text-muted-foreground/70 focus-visible:ring-0"
        />
        <div data-testid="acp-composer-controls" className="ai-composer-controls mt-2 flex min-h-7 min-w-0 flex-nowrap items-center justify-between gap-0.5">
          <div className="ai-composer-controls-left no-scrollbar flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto overflow-y-hidden">
            {session?.capabilities.image && (
              <Tooltip label="Attach image">
                <button type="button" aria-label="Attach image" className="ai-composer-attach flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40" disabled={running} onClick={() => fileRef.current?.click()}>
                  <Paperclip className="size-4" />
                </button>
              </Tooltip>
            )}
            {session ? (
              <SessionStatusPill session={session} busy={busy} />
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
                Start a conversation with {selectedAgent?.definition.name ?? "an agent"}
              </Button>
            )}
          </div>
          <div className="ai-composer-controls-right ml-auto flex shrink-0 flex-nowrap items-center gap-1">
            {session && session.controls.models.length > 0 ? (
              <Select
                value={session.controls.modelId ?? ""}
                disabled={busy || running || session.status !== "ready"}
                onValueChange={(modelId) => void perform(async () => {
                  useAcpSessionsStore.getState().setSnapshot(await acpSetModel(projectId, session.id, modelId));
                })}
              >
                <SelectTrigger aria-label="Agent model" data-testid="acp-model-picker" className="h-7 w-auto min-w-0 max-w-44 gap-1 border-0 bg-transparent px-2 text-xs font-medium shadow-none hover:bg-accent focus:ring-0">
                  <SelectValue placeholder="Agent model" />
                </SelectTrigger>
                <SelectContent className="z-[100]" align="end">
                  {session.controls.models.map((model) => (
                    <SelectItem key={model.modelId} value={model.modelId}>{model.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : session ? (
              <span className="hidden max-w-40 truncate px-1 text-[11px] text-muted-foreground sm:inline">
                {session.controls.modelId ?? "Model managed by the agent"}
              </span>
            ) : null}
            {running ? (
              <Tooltip label="Stop">
                <button type="button" aria-label="Stop" title="Stop the agent" className="ai-composer-submit flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:opacity-90 disabled:opacity-40" disabled={session?.status === "cancelling"} onClick={() => { if (activeId) void perform(async () => { await acpCancel(projectId, activeId); await useAcpSessionsStore.getState().resync(projectId, activeId); }); }}>
                  <Square className="size-3.5 fill-current" />
                </button>
              </Tooltip>
            ) : (
              <Tooltip label="Send">
                <button type="submit" aria-label="Send" className="ai-composer-submit flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary disabled:opacity-40" disabled={!canSend}>
                  <ArrowUp className="size-4" />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </form>
  </section>;
}

const STATUS_DOT: Record<AcpSession["status"], string> = {
  connecting: "bg-primary animate-pulse",
  auth_required: "bg-amber-500",
  ready: "bg-emerald-500",
  running: "bg-primary animate-pulse",
  cancelling: "bg-amber-500 animate-pulse",
  cancelled: "bg-muted-foreground/60",
  disconnected: "bg-muted-foreground/60",
  failed: "bg-destructive",
};

function SessionStatusPill({ session, busy }: { session: AcpSession; busy: boolean }) {
  return (
    <span
      data-testid="acp-session-status"
      data-status={session.status}
      className="inline-flex h-6 max-w-44 shrink-0 items-center gap-1.5 rounded-full border bg-background px-2 text-[10px] text-muted-foreground"
    >
      {busy ? (
        <Loader2 aria-hidden className="size-2.5 shrink-0 animate-spin" />
      ) : (
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[session.status])} />
      )}
      <span className="truncate">{busy ? "Connecting" : `${session.agentId} · ${session.status.replaceAll("_", " ")}`}</span>
    </span>
  );
}

export function agentRoster(catalog: AcpAgentStatus[]): AgentPickerEntry[] {
  const entries: AgentPickerEntry[] = [];
  const seen = new Set<string>();
  for (const agent of catalog) {
    seen.add(agent.definition.id);
    const readiness = acpReadiness(agent);
    entries.push({
      id: agent.definition.id,
      name: agent.definition.name,
      available: readiness === "ready",
      hint:
        readiness === "bridge-missing"
          ? "install the bridge in Agent setup"
          : readiness === "cli-missing"
            ? "CLI not found on this computer"
            : "not available on this computer",
    });
  }
  for (const id of AGENT_MARK_IDS) {
    if (seen.has(id)) continue;
    entries.push({ id, name: AGENT_ROSTER_NAMES[id] ?? id, available: false, hint: "coming soon" });
  }
  return entries;
}

const AGENT_ROSTER_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
  openclaw: "OpenClaw",
  cline: "Cline",
  hermes: "Hermes Agent",
  codebuddy: "CodeBuddy",
  kimi: "Kimi Code",
  pi: "Pi",
  grok: "Grok Build",
  cursor: "Cursor",
  deepseek: "DeepSeek Harness",
  qoder: "Qoder",
  antigravity: "Google Antigravity",
};
