import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";
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
  acpReconnect, acpSetModel, type AcpImage, type AcpSession,
} from "@/lib/acp";
import { attachAcpListeners, isDelegatedSession, useAcpSessionsStore, type AcpAttachment } from "@/store/acp-sessions";
import { AgentLogo } from "./AgentLogo";
import { BridgeInstallCard, ReadinessBadge } from "./AgentReadiness";
import { readinessDetail } from "./agent-copy";
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
  const setDraft = useCallback((value: string) => setComposer(projectId, { draft: value }), [projectId, setComposer]);
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

  return <section className="flex h-full min-h-0 flex-col bg-background text-foreground" aria-label="CLI agent assistant">
    <div className="space-y-1.5 border-b border-border px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Select value={agentId ?? ""} disabled={running || busy} onValueChange={(value) => setComposer(projectId, { agentId: value })}>
          <SelectTrigger aria-label="Agent" data-testid="acp-agent-picker" className="h-7 w-auto min-w-32 max-w-56 gap-1 border-0 bg-transparent px-2 text-xs font-medium shadow-none hover:bg-accent focus:ring-0">
            <SelectValue placeholder="Choose a CLI agent" />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {catalog.map((agent) => (
              <SelectItem key={agent.definition.id} value={agent.definition.id} icon={<AgentLogo agentId={agent.definition.id} size={14} />}>
                {agent.definition.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {session && (
          <span data-testid="acp-session-status" className="min-w-0 truncate text-[11px] text-muted-foreground">
            {session.agentId} · {session.status.replaceAll("_", " ")}
          </span>
        )}
        {session && session.controls.models.length > 0 ? (
          <Select
            value={session.controls.modelId ?? ""}
            disabled={busy || running || session.status !== "ready"}
            onValueChange={(modelId) => void perform(async () => {
              useAcpSessionsStore.getState().setSnapshot(await acpSetModel(projectId, session.id, modelId));
            })}
          >
            <SelectTrigger aria-label="Agent model" data-testid="acp-model-picker" className="ml-auto h-7 w-auto min-w-28 gap-1 border-0 bg-transparent px-2 text-xs font-medium shadow-none hover:bg-accent focus:ring-0">
              <SelectValue placeholder="Agent model" />
            </SelectTrigger>
            <SelectContent className="z-[100]">
              {session.controls.models.map((model) => (
                <SelectItem key={model.modelId} value={model.modelId}>{model.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : session ? (
          <span className="ml-auto truncate text-[11px] text-muted-foreground">
            {session.controls.modelId ?? "Model managed by the agent"}
          </span>
        ) : null}
      </div>
      {selectedAgent && selectedReadiness !== "ready" && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{readinessDetail(selectedAgent, selectedReadiness ?? "unavailable")}</p>
      )}
    </div>
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" onScroll={() => { const el = scrollRef.current; if (el) nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {events[0]?.sequence > 1 && <Button variant="outline" size="sm" type="button" className="mb-3 w-full" disabled={busy} onClick={() => { if (activeId) void perform(() => useAcpSessionsStore.getState().loadEarlier(projectId, activeId)); }}>Load earlier activity</Button>}
      {messages.length > 0 ? <MessageList actions={researchChatActions} messages={messages} chatId={activeId} scrollRef={scrollRef} nearBottomRef={nearBottomRef} /> : <div className="mx-auto max-w-sm space-y-3 py-10 text-sm text-muted-foreground">
        <p>Work with a CLI agent in this project.</p>
        <p>Choose an installed agent and start a conversation. The agent uses its own account and asks before actions that need permission.</p>
        {selectedAgent && selectedReadiness !== "ready" && (
          <BridgeInstallCard agent={selectedAgent} onError={setError} />
        )}
      </div>}
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
    <form className="p-3 pt-2" onSubmit={(event) => { event.preventDefault(); void send(); }}>
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
        <div className="mt-2 flex min-h-7 items-center gap-1">
          {session?.capabilities.image && (
            <Tooltip label="Attach image">
              <Button type="button" variant="ghost" size="icon" aria-label="Attach image" className="size-8 shrink-0 text-muted-foreground" disabled={running} onClick={() => fileRef.current?.click()}>
                <Paperclip className="size-4" />
              </Button>
            </Tooltip>
          )}
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{busy ? "Connecting" : "CLI account limits apply"}</span>
          {selectedAgent && selectedReadiness !== "ready" && <ReadinessBadge readiness={selectedReadiness ?? "unavailable"} />}
          {running ? (
            <Tooltip label="Stop">
              <Button type="button" aria-label="Stop" size="icon" className="size-8 shrink-0 rounded-full" disabled={session?.status === "cancelling"} onClick={() => { if (activeId) void perform(async () => { await acpCancel(projectId, activeId); await useAcpSessionsStore.getState().resync(projectId, activeId); }); }}>
                <Square className="size-3.5 fill-current" />
              </Button>
            </Tooltip>
          ) : (
            <Tooltip label="Send">
              <Button type="submit" aria-label="Send" size="icon" className="size-8 shrink-0 rounded-full" disabled={!canSend}>
                <ArrowUp className="size-4" />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
    </form>
  </section>;
}
