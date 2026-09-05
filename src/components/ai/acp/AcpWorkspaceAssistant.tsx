import { Button } from "@/components/ui/button";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useResearchChatActions } from "@/components/ai/use-research-chat-actions";
import { MessageList } from "@/components/ai/MessageList";
import { AcpAgentsTab } from "@/components/settings/ai/AcpAgentsTab";
import {
  acpAuthenticate, acpCancel, acpDisconnect, acpError, acpPermission, acpPrompt, acpReconnect,
  acpSetModel, acpStart, type AcpImage, type AcpPermission, type AcpSession,
} from "@/lib/acp";
import { attachAcpListeners, useAcpSessionsStore } from "@/store/acp-sessions";
import { createAcpProjector } from "./projection";

const EMPTY_EVENTS: never[] = [];
const EMPTY_PERMISSIONS: never[] = [];
const button = "rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed";

function PermissionCard({ request, onChoose }: { request: AcpPermission; onChoose: (id: string, option: string | null) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(request.expiresAt <= Date.now());
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), Math.max(0, request.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [request.expiresAt]);
  return <fieldset className="rounded-lg border border-border bg-muted/50 p-3" aria-label="Agent permission">
    <p className="text-sm font-medium">{request.title}</p>
    {expired ? <p className="mt-2 text-xs text-muted-foreground">This request expired. Ask the agent to try again.</p> : <div className="mt-2 flex flex-wrap gap-2">
      {request.options.map((option) => <Button variant="outline" size="sm" key={option.optionId} type="button" className={button} disabled={busy} onClick={() => { setBusy(true); void onChoose(request.id, option.optionId).finally(() => setBusy(false)); }}>{option.name}</Button>)}
      <Button variant="outline" size="sm" type="button" className={button} disabled={busy} onClick={() => { setBusy(true); void onChoose(request.id, null).finally(() => setBusy(false)); }}>Dismiss</Button>
    </div>}
  </fieldset>;
}

function canReconnect(session: AcpSession): boolean {
  return !session.taskId && (!session.nativeSessionId || session.capabilities.resume || session.capabilities.loadSession);
}

export function AcpWorkspaceAssistant({ projectId }: { projectId: string }) {
  const researchChatActions = useResearchChatActions(projectId);
  const catalog = useAcpSessionsStore((state) => state.catalog);
  const activeId = useAcpSessionsStore((state) => state.activeByProject[projectId] ?? null);
  const allSessions = useAcpSessionsStore((state) => state.sessions);
  const session = activeId ? allSessions[activeId] : undefined;
  const events = useAcpSessionsStore((state) => activeId ? state.events[activeId] ?? EMPTY_EVENTS : EMPTY_EVENTS);
  const permissions = useAcpSessionsStore((state) => activeId ? state.permissions[activeId] ?? EMPTY_PERMISSIONS : EMPTY_PERMISSIONS);
  const [agentId, setAgentId] = useState("claude");
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<{ id: string; name: string; image: AcpImage }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [setup, setSetup] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const running = session?.status === "running" || session?.status === "cancelling" || sending;
  const projectEvents = useMemo(() => createAcpProjector(), []);
  const messages = useMemo(() => projectEvents(events, running), [events, running, projectEvents]);
  const sessions = useMemo(() => Object.values(allSessions).filter((value) => value.projectId === projectId).sort((a, b) => b.updatedAt - a.updatedAt), [allSessions, projectId]);

  useEffect(() => {
    let disposed = false;
    let detach: (() => void) | undefined;
    void (async () => {
      detach = await attachAcpListeners();
      if (disposed) { detach(); return; }
      const state = useAcpSessionsStore.getState();
      await Promise.all([state.refreshCatalog(), state.loadProject(projectId)]);
      const id = state.activeByProject[projectId];
      if (id) await state.open(projectId, id);
    })().catch((value: unknown) => { if (!disposed) setError(acpError(value)); });
    return () => {
      disposed = true;
      detach?.();
    };
  }, [projectId]);

  useLayoutEffect(() => {
    if (messages.length && activeId && nearBottomRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, activeId]);

  const perform = async (action: () => Promise<void>) => {
    setError(null); setBusy(true);
    try { await action(); } catch (value) { setError(acpError(value)); }
    finally { setBusy(false); }
  };
  const start = () => perform(async () => {
    if (activeId && session && ["ready", "auth_required"].includes(session.status)) await acpDisconnect(projectId, activeId);
    const snapshot = await acpStart(projectId, agentId);
    useAcpSessionsStore.getState().setSnapshot(snapshot);
    useAcpSessionsStore.getState().setActive(projectId, snapshot.session.id);
    nearBottomRef.current = true;
  });
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
    const clearComposer = () => { setDraft(""); setImages([]); };
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
    try { await acpPermission(projectId, activeId, id, option); }
    catch (value) { setError(acpError(value)); }
  };

  return <section className="flex h-full min-h-0 flex-col bg-background text-foreground" aria-label="CLI agent assistant">
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
      <label className="sr-only" htmlFor="acp-agent">Agent</label>
      <select id="acp-agent" className="min-w-0 flex-1 rounded-md border border-border bg-background p-1.5 text-xs" value={agentId} disabled={running || busy} onChange={(event) => setAgentId(event.target.value)}>
        {catalog.length === 0 && <option value="claude">Claude Code</option>}
        {catalog.map((agent) => <option key={agent.definition.id} value={agent.definition.id}>{agent.definition.name}{agent.installed ? "" : " (not installed)"}</option>)}
      </select>
      <Button variant="outline" size="sm" type="button" className={button} disabled={busy || running || !catalog.find((agent) => agent.definition.id === agentId)?.installed} onClick={() => void start()}>New conversation</Button>
      <Button variant="outline" size="sm" type="button" className={button} onClick={() => setSetup(!setup)} aria-expanded={setup}>Agent setup</Button>
      {sessions.length > 0 && <>
        <label className="sr-only" htmlFor="acp-history">Saved conversations</label>
        <select id="acp-history" className="w-full rounded-md border border-border bg-background p-1.5 text-xs" value={activeId ?? ""} disabled={busy || running} onChange={(event) => { const selectedId = event.target.value; nearBottomRef.current = true; void perform(async () => { if (activeId && session?.status === "ready") await acpDisconnect(projectId, activeId); await useAcpSessionsStore.getState().open(projectId, selectedId); }); }}>
          <option value="" disabled>Saved conversations</option>
          {sessions.map((value) => <option key={value.id} value={value.id}>{value.title || "Untitled conversation"} · {value.agentId}</option>)}
        </select>
      </>}
      {session && <div className="flex w-full items-center gap-2 text-xs text-muted-foreground">
        <span>{session.agentId} · {session.status.replaceAll("_", " ")}</span>
        {session.controls.models.length > 0 ? <select aria-label="Agent model" className="ml-auto min-w-0 rounded border border-border bg-background p-1" disabled={busy || running || session.status !== "ready"} value={session.controls.modelId ?? ""} onChange={(event) => { const modelId = event.target.value; void perform(async () => { useAcpSessionsStore.getState().setSnapshot(await acpSetModel(projectId, session.id, modelId)); }); }}>
          {!session.controls.modelId && <option value="" disabled>Agent model</option>}
          {session.controls.models.map((model) => <option key={model.modelId} value={model.modelId}>{model.name}</option>)}
        </select> : <span className="ml-auto">{session.controls.modelId ?? "Model managed by the agent"}</span>}
      </div>}
    </div>
    {setup ? <div className="min-h-0 flex-1 overflow-y-auto p-4"><AcpAgentsTab projectId={projectId} /></div> : <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" onScroll={() => { const el = scrollRef.current; if (el) nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {events[0]?.sequence > 1 && <Button variant="outline" size="sm" type="button" className={`${button} mb-3 w-full`} disabled={busy} onClick={() => { if (activeId) void perform(() => useAcpSessionsStore.getState().loadEarlier(projectId, activeId)); }}>Load earlier activity</Button>}
      {messages.length > 0 ? <MessageList actions={researchChatActions} messages={messages} chatId={activeId} scrollRef={scrollRef} nearBottomRef={nearBottomRef} /> : <div className="mx-auto max-w-sm py-10 text-sm text-muted-foreground">
        <p>Work with a CLI agent in this project.</p><p className="mt-2">Choose an installed agent and start a conversation. The agent uses its own account and asks before actions that need permission.</p>
      </div>}
    </div>}
    {(error || session?.error) && <div role="alert" className="mx-3 my-2 rounded-md border border-destructive/40 p-2 text-xs text-destructive">{error ?? session?.error}</div>}
    {session?.status === "auth_required" && <div className="space-y-2 border-t border-border p-3 text-xs">
      <p>{catalog.find((agent) => agent.definition.id === session.agentId)?.signInHint ?? "Sign in using this agent's CLI, then reconnect."}</p>
      <div className="flex flex-wrap gap-2">{session.authMethods.map((method) => <Button variant="outline" size="sm" key={method.id} type="button" className={button} disabled={busy} onClick={() => void perform(async () => { useAcpSessionsStore.getState().setSnapshot(await acpAuthenticate(projectId, session.id, method.id)); })}>{method.name}</Button>)}
      <Button variant="outline" size="sm" type="button" className={button} disabled={busy} onClick={() => void perform(async () => { await acpDisconnect(projectId, session.id); useAcpSessionsStore.getState().setSnapshot(await acpReconnect(projectId, session.id)); })}>Reconnect after sign-in</Button></div>
    </div>}
    {session && ["disconnected", "cancelled", "failed"].includes(session.status) && <div className="border-t border-border p-3 text-xs">
      {canReconnect(session) ? <Button variant="outline" size="sm" type="button" className={button} disabled={busy} onClick={() => void perform(async () => { useAcpSessionsStore.getState().setSnapshot(await acpReconnect(projectId, session.id)); })}>Reconnect to conversation</Button> : <p>{session.taskId ? "Open the research task to resume this work." : "This agent cannot resume saved conversations. Start a new conversation when you are ready."}</p>}
    </div>}
    {permissions.length > 0 && <div className="max-h-64 space-y-2 overflow-y-auto border-t border-border p-3">{permissions.map((request) => <PermissionCard key={request.id} request={request} onChoose={choosePermission} />)}</div>}
    <form className="space-y-2 border-t border-border p-3" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <textarea aria-label="Message CLI agent" placeholder={session?.status === "ready" ? "Ask the agent to work on this project…" : "Start or reconnect a conversation to send a message"} className="max-h-48 min-h-20 w-full resize-y rounded-lg border border-border bg-background p-2 text-sm disabled:opacity-50" value={draft} disabled={session?.status !== "ready" || sending} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} />
      {images.length > 0 && <div className="flex flex-wrap gap-2">{images.map((value, index) => <Button variant="outline" size="sm" key={value.id} type="button" className={button} onClick={() => setImages(images.filter((_, i) => i !== index))}>{value.name} ×</Button>)}</div>}
      <div className="flex items-center gap-2">
        {session?.capabilities.image && <>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (file.size > 480 * 1024 || images.length >= 4) { setError("Choose an image smaller than 480 KiB. You can attach up to four images."); return; } const reader = new FileReader(); reader.onload = () => { const data = String(reader.result).split(",")[1]; if (data) setImages((current) => [...current, { id: crypto.randomUUID(), name: file.name, image: { mimeType: file.type, data } }]); }; reader.onerror = () => setError("The image could not be read."); reader.readAsDataURL(file); }} />
          <Button variant="outline" size="sm" type="button" className={button} disabled={running} onClick={() => fileRef.current?.click()}>Attach image</Button>
        </>}
        <span className="flex-1 text-[11px] text-muted-foreground">{busy ? "Connecting…" : "CLI account limits apply"}</span>
        {running ? <Button variant="outline" size="sm" type="button" className={button} disabled={session?.status === "cancelling"} onClick={() => { if (activeId) void perform(async () => { await acpCancel(projectId, activeId); await useAcpSessionsStore.getState().resync(projectId, activeId); }); }}>Stop</Button> : <Button variant="outline" size="sm" type="submit" className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`} disabled={busy || session?.status !== "ready" || (!draft.trim() && images.length === 0)}>Send</Button>}
      </div>
    </form>
  </section>;
}
