import { memo, useState, useRef, useEffect, useCallback } from "react";
import { streamText } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import {
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Sparkles,
  Square,
  Wrench,
  XCircle,
} from "lucide-react";
import { useFilesStore } from "@/store/files";
import { getConfig, setConfig, gitLog, gitAutoCommit } from "@/lib/tauri";
import { listOllamaModels } from "@/lib/ollama";
import { createOpenLeafTools, type ToolApprovalRequest } from "@/lib/ai-tools";
import { ToolConfirm } from "@/components/ai/ToolConfirm";
import { AttachmentChips, type PendingAttachment } from "@/components/ai/AttachmentChips";
import { toast } from "@/lib/toast";
import { buildModel as buildAiModel, defaultModel, PROVIDERS } from "@/lib/ai-providers";
import { useSettingsStore } from "@/store/settings";
import { useChatsStore, type ChatMessage, type StoredChat, type ToolEntry } from "@/store/chats";
import { ChatHistoryModal } from "@/components/ai/ChatHistoryModal";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Fix any LaTeX errors in my document",
  "Create a new section called 'Publications'",
  "Search for all \\cite commands",
  "Recompile and check for errors",
];

const TOOLS_LIST = "read_file, write_file, replace_in_file, create_file, delete_file, rename_file, list_files, search_project, compile, get_log, get_pdf_text, set_main_doc, toggle_theme";

function Shimmer({ text }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-2">
      <div className="flex gap-1">
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
      </div>
      {text && <span className="text-xs text-muted-foreground">{text}</span>}
    </div>
  );
}

function ToolBadge({ tc }: { tc: ToolEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border bg-muted/30 text-xs">
      <button
        onClick={() => tc.output && setExpanded(!expanded)}
        className={cn("flex w-full items-center gap-2 px-2.5 py-1.5", tc.output && "cursor-pointer hover:bg-accent/50")}
      >
        <Wrench className="size-3.5 text-muted-foreground" />
        <span className="font-mono">{tc.name}</span>
        {tc.status === "running" && <Loader2 className="size-3 animate-spin" />}
        {tc.status === "done" && <CheckCircle2 className="size-3 text-emerald-500" />}
        {tc.status === "error" && <XCircle className="size-3 text-destructive" />}
        {tc.output && (
          <ChevronRight className={cn("ml-auto size-3 text-muted-foreground transition-transform", expanded && "rotate-90")} />
        )}
      </button>
      {expanded && tc.output && (
        <pre className="max-h-40 overflow-auto border-t px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground">
          {tc.output}
        </pre>
      )}
    </div>
  );
}

/** Turn a raw provider failure into a friendly, actionable message, if we can. */
function friendlyHint(text: string, statusCode?: number): string | null {
  const t = text.toLowerCase();
  if (
    statusCode === 402 ||
    /insufficient balance|no resource package|recharge|out of credit|insufficient[_ ]?quota|exceeded your current quota|billing|payment required/.test(t)
  ) {
    return "Your AI provider is out of credits or quota. Top up the account, or switch to another provider (or local Ollama) from the model menu above.";
  }
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    /invalid api key|incorrect api key|unauthorized|invalid[_ ]?api[_ ]?key|authentication|no api key/.test(t)
  ) {
    return "Your API key looks invalid or expired. Update it in Settings → AI Assistant, or switch providers from the model menu above.";
  }
  if (statusCode === 429 || /rate limit|too many requests|\b429\b/.test(t)) {
    return "The provider is rate-limiting requests. Wait a moment and retry, or switch providers from the model menu above.";
  }
  if (/econnrefused|failed to fetch|fetch failed|load failed|network error|not reachable|connection refused/.test(t)) {
    return "Couldn't reach the AI provider. Check your connection — or, if you're using Ollama, make sure it's running (Settings → AI Assistant → Check for Ollama).";
  }
  return null;
}

function formatError(e: unknown, providerLabel?: string): string {
  const err = e as any;
  const statusCode: number | undefined = err?.statusCode ?? err?.status;
  let bodyMsg = "";
  if (err?.responseBody) {
    try {
      bodyMsg = JSON.parse(err.responseBody)?.error?.message ?? String(err.responseBody);
    } catch {
      bodyMsg = String(err.responseBody);
    }
  }
  // Name the active provider so it's clear which endpoint failed, and always
  // keep a compact raw detail (status + provider message) for diagnosis.
  const who = providerLabel ? `${providerLabel} — ` : "";
  const rawDetail =
    bodyMsg && bodyMsg !== err?.message
      ? ` (${bodyMsg.slice(0, 160)}${statusCode ? `, HTTP ${statusCode}` : ""})`
      : statusCode
        ? ` (HTTP ${statusCode})`
        : "";
  const hint = friendlyHint(`${err?.message ?? String(e)} ${bodyMsg}`, statusCode);
  if (hint) return `⚠ ${who}${hint}${rawDetail}`;
  // Unknown error — keep the technical details for debugging.
  const parts: string[] = [`⚠ ${who}`.trimEnd()];
  if (err?.name) parts.push(err.name);
  if (err?.message) parts.push(err.message);
  if (statusCode) parts.push(`(HTTP ${statusCode})`);
  if (bodyMsg && bodyMsg !== err?.message) parts.push(`→ ${bodyMsg.slice(0, 300)}`);
  if (parts.length <= 1) parts.push(String(e));
  return parts.join(" ");
}

/**
 * Whether an error is worth retrying. Network drops, rate limits, and 5xx are
 * transient; bad keys, quota/balance, bad requests, and missing models are
 * permanent — retrying those just hides the real message behind "retrying…".
 */
function isRetryable(e: unknown): boolean {
  const err = e as any;
  const status: number | undefined = err?.statusCode ?? err?.status;
  if (status && [400, 401, 402, 403, 404, 405, 422].includes(status)) return false;
  const text = `${err?.message ?? ""} ${err?.responseBody ?? ""}`.toLowerCase();
  if (
    /insufficient balance|no resource package|out of credit|insufficient[_ ]?quota|billing|payment required|invalid api key|incorrect api key|unauthorized|authentication|no api key|model.*(not found|does not exist|not exist|unavailable)|invalid model|not supported/.test(
      text
    )
  ) {
    return false;
  }
  return true;
}

const MAX_STEPS = 50;
const MAX_RETRIES = 4;
const RETRY_BASE_MS = 800;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed marker:text-muted-foreground">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 dark:text-primary">
      {children}
    </a>
  ),
  h1: ({ children }) => <h1 className="mb-1 text-base font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1 text-[0.95em] font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 text-[0.9em] font-semibold">{children}</h3>,
  hr: () => <hr className="my-2 border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-2 italic text-muted-foreground">{children}</blockquote>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-md bg-background/70 p-2.5 text-[0.85em] [scrollbar-width:thin]">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const text = typeof children === "string" ? children : "";
    const isBlock = /language-/.test(className || "") || text.includes("\n");
    if (isBlock) return <code className={cn("font-mono", className)}>{children}</code>;
    return <code className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
  },
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto">
      <table className="w-full border-collapse text-[0.85em]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
};

/**
 * A single chat message (tool badges + content bubble). Memoized on the message
 * object reference: `updateLast` only replaces the *last* message's reference
 * each streamed token, so every earlier message skips re-render (and skips
 * re-parsing its markdown) instead of reconciling the whole list per token.
 */
const MessageItem = memo(function MessageItem({ msg }: { msg: ChatMessage }) {
  return (
    <div className={cn("flex flex-col gap-1.5", msg.role === "user" && "items-end")}>
      {msg.toolCalls?.map((tc, j) => (
        <ToolBadge key={j} tc={tc} />
      ))}
      {msg.attachments && msg.attachments.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {msg.attachments.map((a, j) => (
            <span
              key={j}
              className="flex items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              <Paperclip className="size-3" />
              <span className="max-w-[140px] truncate">{a.name}</span>
            </span>
          ))}
        </div>
      )}
      {msg.content ? (
        <div
          className={cn(
            "max-w-[85%] overflow-hidden rounded-lg px-3 py-2 text-sm",
            msg.role === "user" ? "bg-primary text-white" : "bg-muted text-foreground"
          )}
        >
          {msg.role === "assistant" ? (
            <div className="chat-markdown min-w-0">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {msg.content}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
          )}
        </div>
      ) : null}
    </div>
  );
});

export function ChatPanel() {
  const projectId = useFilesStore((s) => s.projectId);
  const projectName = useFilesStore((s) => s.projectName);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setSettingsInitialSection = useSettingsStore((s) => s.setSettingsInitialSection);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeId);
  const loadChats = useChatsStore((s) => s.load);
  const removeChat = useChatsStore((s) => s.remove);
  const setActiveChat = useChatsStore((s) => s.setActive);
  const activeChat = chats.find((c) => c.id === activeChatId) ?? null;

  const openAISettings = () => { setSettingsInitialSection("ai"); setSettingsOpen(true); };

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("gpt-4o");
  const [modelDropdown, setModelDropdown] = useState(false);
  const [apiKey, setApiKey] = useState("");
  // All configured provider credentials (id -> key/host), so the switcher can
  // offer every provider the user has set up, not just the default one.
  const [keysMap, setKeysMap] = useState<Record<string, string>>({});
  // Models actually installed in local Ollama (populated when it's configured).
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [thinkingText, setThinkingText] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [currentHead, setCurrentHead] = useState<string | null>(null);
  const [quotaWarning, setQuotaWarning] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<
    { req: ToolApprovalRequest; resolve: (ok: boolean) => void } | null
  >(null);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  // Always-current snapshot so `send` (a useCallback) reads the latest list
  // without depending on it.
  const attachmentsRef = useRef<PendingAttachment[]>(attachments);
  attachmentsRef.current = attachments;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_ATTACH = 6;
  const MAX_ATTACH_BYTES = 10 * 1024 * 1024; // 10 MB per file

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked: PendingAttachment[] = [];
    for (const f of Array.from(files)) {
      if (f.size > MAX_ATTACH_BYTES) {
        toast.error(`${f.name} is too large (max 10 MB).`);
        continue;
      }
      try {
        const dataUrl = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result as string);
          r.onerror = () => rej(r.error);
          r.readAsDataURL(f);
        });
        picked.push({
          id: `${f.name}-${f.size}-${f.lastModified}`,
          name: f.name,
          mediaType: f.type || "application/octet-stream",
          dataUrl,
        });
      } catch {
        toast.error(`Couldn't read ${f.name}.`);
      }
    }
    if (picked.length) setAttachments((cur) => [...cur, ...picked].slice(0, MAX_ATTACH));
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  // Aborts the in-flight AI run (Stop button, project switch, unmount).
  const abortRef = useRef<AbortController | null>(null);
  // Trailing-debounce timer for persisting the streaming conversation.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Surface a one-time warning if chat history can no longer be saved (quota).
  useEffect(() => {
    const onQuota = () => setQuotaWarning(true);
    window.addEventListener("openleaf:chats-quota-exceeded", onQuota);
    return () => window.removeEventListener("openleaf:chats-quota-exceeded", onQuota);
  }, []);

  useEffect(() => {
    const load = () => {
      void getConfig().then((cfg) => {
        const saved = cfg.ai_provider || "openai";
        const keys = { ...(cfg.ai_keys ?? {}) };
        // Fold the legacy single key into the map so it counts as configured.
        if (cfg.ai_api_key && !keys[saved]) keys[saved] = cfg.ai_api_key;
        setKeysMap(keys);
        // Use the saved provider if it has a key; otherwise fall back to the
        // first configured one (e.g. the saved provider's key was removed).
        const configured = Object.keys(keys).filter((k) => (keys[k] ?? "").trim());
        const provider = (keys[saved] ?? "").trim() ? saved : configured[0] ?? saved;
        setProvider(provider);
        setApiKey(keys[provider] || "");
        setModel(
          provider === saved && cfg.ai_model ? cfg.ai_model : defaultModel(provider)
        );
      });
    };
    load();
    // Re-read when AI settings change elsewhere (e.g. connected in Settings),
    // so the panel updates live without a remount.
    window.addEventListener("openleaf:ai-config-changed", load);
    return () => window.removeEventListener("openleaf:ai-config-changed", load);
  }, []);

  // Detect installed Ollama models whenever Ollama is configured.
  useEffect(() => {
    const host = keysMap.ollama;
    if (!host) {
      setOllamaModels([]);
      return;
    }
    listOllamaModels(host)
      .then(setOllamaModels)
      .catch(() => setOllamaModels([]));
  }, [keysMap.ollama]);

  // Switch the active provider + model from the chat, persisting it as default.
  const selectModel = useCallback(
    async (pid: string, mid: string) => {
      setProvider(pid);
      setModel(mid);
      setApiKey(keysMap[pid] || "");
      setModelDropdown(false);
      try {
        const cfg = await getConfig();
        await setConfig({ ...cfg, ai_provider: pid, ai_model: mid });
      } catch {
        /* non-fatal: the switch still applies to this session */
      }
    },
    [keysMap]
  );

  // Providers the user has set up (a non-empty key/host), in catalog order.
  const configuredProviders = PROVIDERS.filter(
    (p) => (keysMap[p.id] ?? "").trim().length > 0
  );

  // Load persisted chats + current git HEAD whenever the project changes.
  useEffect(() => {
    if (!projectId) return;
    loadChats(projectId);
    setMessages([]);
    setActiveChat(null);
    void gitLog(projectId)
      .then((log) => setCurrentHead(log[0]?.oid ?? null))
      .catch(() => setCurrentHead(null));
  }, [projectId, loadChats, setActiveChat]);

  // Persist the active conversation into the chats store (immediately).
  const persist = useCallback((msgs: ChatMessage[]) => {
    const id = useChatsStore.getState().activeId;
    if (id) useChatsStore.getState().saveMessages(id, msgs);
  }, []);

  // Trailing-debounced persist: during streaming, `updateLast` fires on every
  // token; without debouncing we'd JSON.stringify + localStorage.setItem the
  // whole conversation per token (main-thread jank). Coalesce to ~1 write/400ms.
  const persistDebounced = useCallback(
    (msgs: ChatMessage[]) => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        persist(msgs);
      }, 400);
    },
    [persist]
  );


  // Open an existing chat from history.
  const openChat = useCallback(
    (chat: StoredChat) => {
      setActiveChat(chat.id);
      setMessages(chat.messages);
      setHistoryOpen(false);
    },
    [setActiveChat]
  );

  // Start a brand-new conversation.
  const newChat = useCallback(() => {
    if (streaming) return;
    setActiveChat(null);
    setMessages([]);
  }, [streaming, setActiveChat]);

  useEffect(() => {
    if (!modelDropdown) return;
    const onDown = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) setModelDropdown(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [modelDropdown]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinkingText]);

  /** Update the last assistant message. Persist is debounced so a long stream
   *  doesn't rewrite the entire conversation to localStorage on every token. */
  const updateLast = (fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => {
      const copy = [...prev];
      copy[copy.length - 1] = fn(copy[copy.length - 1]);
      persistDebounced(copy);
      return copy;
    });
  };

  const send = useCallback(async (text: string) => {
    const outgoing = attachmentsRef.current;
    if ((!text.trim() && outgoing.length === 0) || streaming) return;
    if (!apiKey) { openAISettings(); return; }

    // Fresh abort controller for this run (Stop button / project switch / unmount).
    const ac = new AbortController();
    abortRef.current = ac;

    // Human-in-the-loop gate for destructive edits: the tool's execute() awaits
    // this, which naturally pauses the stream on that tool until the user picks.
    // Resolves false if the run is stopped while a prompt is open.
    const confirm = (req: ToolApprovalRequest): Promise<boolean> =>
      new Promise((resolve) => {
        if (ac.signal.aborted) { resolve(false); return; }
        const finish = (ok: boolean) => {
          ac.signal.removeEventListener("abort", onAbort);
          setPendingApproval(null);
          resolve(ok);
        };
        const onAbort = () => finish(false);
        ac.signal.addEventListener("abort", onAbort, { once: true });
        setPendingApproval({ req, resolve: finish });
      });

    // Checkpoint the project before the agent edits anything, so a bad edit can
    // always be reverted from git history (best-effort; never blocks the chat).
    if (projectId) {
      try {
        await gitAutoCommit(projectId, "OpenLeaf AI checkpoint");
      } catch {
        /* not a git repo yet / nothing to commit - non-fatal */
      }
    }

    const userMsg: ChatMessage = {
      role: "user",
      content: text,
      ...(outgoing.length
        ? { attachments: outgoing.map((a) => ({ name: a.name, mediaType: a.mediaType })) }
        : {}),
    };
    const nextMessages: ChatMessage[] = [...messages, userMsg, { role: "assistant", content: "", toolCalls: [] }];
    setMessages(nextMessages);
    setInput("");
    setAttachments([]);
    setStreaming(true);
    setThinkingText("Thinking…");

    // Persist this conversation as a chat (creates one on the first message).
    {
      const cs = useChatsStore.getState();
      let chatId = cs.activeId;
      if (!chatId && projectId) {
        const created = cs.create(projectId, currentHead);
        chatId = created.id;
      }
      if (chatId) cs.saveMessages(chatId, nextMessages);
    }

    const systemPrompt = `You are OpenLeaf AI, an assistant for a local-first LaTeX editor called OpenLeaf.
You have full, reliable control over the project via these tools: ${TOOLS_LIST}.
The current project is "${projectName}" (ID: ${projectId}). Main document: ${useFilesStore.getState().mainDoc || "main.tex"}.

Tool notes:
- write_file replaces the ENTIRE file. replace_in_file does a precise find/replace and is better for small fixes.
- compile persists the active file, builds, and returns { success, errors, has_pdf, log_tail }.
- get_log returns the full compile log; get_pdf_text returns the rendered PDF's text so you can verify output.
- File reads/writes are deterministic and hit disk immediately.

Workflow for "fix errors" requests:
1. read_file the relevant document, or compile first to get errors.
2. Apply fixes (prefer replace_in_file for targeted edits).
3. compile again. If errors remain, read get_log for context, fix, and recompile. Iterate until success is true with an empty errors array.
4. Optionally verify the result with get_pdf_text.
Do not stop until the task is genuinely complete. Briefly explain what you did.`;

    // Build conversation history from current messages + new user msg.
    // Using a plain array that grows as steps complete.
    type Msg = { role: string; content: string; tool_calls?: any[]; tool_call_id?: string; name?: string };
    const apiMessages: Msg[] = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
    // Attach files/images to the final user message as multimodal content parts
    // (images need a vision-capable model; other providers surface an error).
    if (outgoing.length) {
      apiMessages[apiMessages.length - 1] = {
        role: "user",
        content: [
          ...(text.trim() ? [{ type: "text", text }] : []),
          ...outgoing.map((a) =>
            a.mediaType.startsWith("image/")
              ? { type: "image", image: a.dataUrl }
              : { type: "file", data: a.dataUrl, mediaType: a.mediaType },
          ),
        ],
      } as unknown as Msg;
    }

    try {
      // Runs a single model step against `apiMessages` and streams the result
      // into the UI. Returns the accumulated text, tool calls/results, and any
      // stream-level error. Pure w.r.t. apiMessages (does not mutate it).
      const runStep = async (modelInstance: any, tools: any) => {
        const result = streamText({
          model: modelInstance,
          messages: apiMessages as any,
          tools: tools as any,
          system: systemPrompt,
          abortSignal: ac.signal,
        } as any);

        let stepText = "";
        const stepToolCalls: { id: string; name: string; args: any }[] = [];
        const stepToolResults: { id: string; name: string; output: any }[] = [];
        let errorMsg = "";
        let errorRetryable = true;

        for await (const part of result.fullStream) {
          if (ac.signal.aborted) break;
          switch (part.type) {
            case "text-delta":
              setThinkingText(null);
              stepText += (part as any).text || (part as any).textDelta || "";
              updateLast((m) => ({ ...m, content: stepText }));
              break;

            case "tool-call": {
              const tc = part as any;
              stepToolCalls.push({ id: tc.toolCallId || tc.id || `${tc.toolName}-${Date.now()}`, name: tc.toolName, args: tc.input || tc.args || {} });
              setThinkingText(`Running ${tc.toolName}…`);
              updateLast((m) => ({
                ...m,
                toolCalls: [...(m.toolCalls || []), { name: tc.toolName, status: "running" as const }],
              }));
              break;
            }

            case "tool-result": {
              const tr = part as any;
              const out = tr.output ?? tr.result ?? {};
              const outStr = typeof out === "string" ? out.slice(0, 500) : JSON.stringify(out, null, 2).slice(0, 500);
              stepToolResults.push({
                id: tr.toolCallId || stepToolCalls.find((tc) => tc.name === tr.toolName)?.id || "",
                name: tr.toolName,
                output: out,
              });
              setThinkingText("Processing result…");
              updateLast((m) => {
                const calls = [...(m.toolCalls || [])];
                for (let i = calls.length - 1; i >= 0; i--) {
                  if (calls[i].name === tr.toolName && calls[i].status === "running") {
                    calls[i] = { ...calls[i], status: "done", output: outStr };
                    break;
                  }
                }
                return { ...m, toolCalls: calls };
              });
              break;
            }

            case "error":
              errorMsg = formatError(
                (part as any).error,
                PROVIDERS.find((p) => p.id === provider)?.name
              );
              errorRetryable = isRetryable((part as any).error);
              break;

            case "finish":
              break;
          }
        }

        return { stepText, stepToolCalls, stepToolResults, errorMsg, errorRetryable };
      };

      let reachedCap = false;

      for (let step = 0; step < MAX_STEPS; step++) {
        if (ac.signal.aborted) break;
        setThinkingText(step === 0 ? "Thinking…" : "Continuing…");

        const modelInstance = buildAiModel(provider, model, apiKey);
        const tools = createOpenLeafTools({ confirm });

        // Retry the same step on stream disconnects / transient API errors so a
        // dropped connection never abandons an unfinished task.
        let stepText = "";
        let stepToolCalls: { id: string; name: string; args: any }[] = [];
        let stepToolResults: { id: string; name: string; output: any }[] = [];
        let fatalError = "";

        for (let attempt = 0; ; attempt++) {
          try {
            const r = await runStep(modelInstance, tools);
            stepText = r.stepText;
            stepToolCalls = r.stepToolCalls;
            stepToolResults = r.stepToolResults;
            // Only retry when nothing useful happened (no text, no tool calls).
            const isEmpty = !stepText && stepToolCalls.length === 0;
            if (r.errorMsg && isEmpty && r.errorRetryable && attempt < MAX_RETRIES) {
              setThinkingText(`Connection issue - retrying (${attempt + 1}/${MAX_RETRIES})…`);
              await sleep(RETRY_BASE_MS * (attempt + 1));
              continue;
            }
            // Permanent error (bad key, quota, model): stop and show it now.
            if (r.errorMsg) fatalError = r.errorMsg;
            break;
          } catch (e) {
            // A user-initiated stop must not be retried — let it unwind.
            if (ac.signal.aborted) throw e;
            if (attempt < MAX_RETRIES) {
              setThinkingText(`Stream interrupted - retrying (${attempt + 1}/${MAX_RETRIES})…`);
              await sleep(RETRY_BASE_MS * (attempt + 1));
              continue;
            }
            throw e;
          }
        }

        // Exhausted retries with nothing to show for it - surface and stop.
        if (fatalError && !stepText && stepToolCalls.length === 0) {
          updateLast((m) => ({ ...m, content: (m.content ? m.content + "\n\n" : "") + fatalError }));
          break;
        }

        // If the model didn't call any tools, it gave a final answer - done.
        if (stepToolCalls.length === 0) {
          break;
        }

        // Carry this step's tool calls + results into the next round.
        apiMessages.push({
          role: "assistant",
          content: [
            ...(stepText ? [{ type: "text", text: stepText }] : []),
            ...stepToolCalls.map((tc) => ({
              type: "tool-call",
              toolCallId: tc.id,
              toolName: tc.name,
              input: tc.args,
            })),
          ],
        } as any);

        for (const tr of stepToolResults) {
          apiMessages.push({
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: tr.id,
                toolName: tr.name,
                output: {
                  type: "json",
                  value: tr.output,
                },
              },
            ],
          } as any);
        }

        if (step === MAX_STEPS - 1) reachedCap = true;
      }

      if (reachedCap) {
        updateLast((m) => ({
          ...m,
          content: (m.content ? m.content + "\n\n" : "") +
            "_Reached the step safety limit. You can continue by sending another message._",
        }));
      }
    } catch (e) {
      // A user-initiated stop (or teardown) isn't an error - note it quietly.
      if (ac.signal.aborted || (e as any)?.name === "AbortError") {
        updateLast((m) => ({
          ...m,
          content: (m.content ? m.content + "\n\n" : "") + "_Stopped._",
        }));
      } else {
        const errMsg = formatError(e, PROVIDERS.find((p) => p.id === provider)?.name);
        updateLast((m) => ({
          ...m,
          content: errMsg.includes("NoOutputGenerated")
            ? "The model returned no output. Check Settings → AI Assistant."
            : errMsg,
        }));
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setStreaming(false);
      setThinkingText(null);
      // Persist the final state of the conversation (flush any pending debounce).
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      const cs = useChatsStore.getState();
      if (cs.activeId) {
        setMessages((cur) => {
          cs.saveMessages(cs.activeId!, cur);
          return cur;
        });
      }
    }
  }, [messages, streaming, apiKey, provider, model, projectId, projectName, currentHead]);

  // Stop the current AI run (used by the Stop button).
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Abort any in-flight run when the project changes or the panel unmounts, so a
  // stale stream can't keep spending tokens or writing into the wrong chat.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [projectId]);

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Header - model + controls */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b px-2">
        {configuredProviders.length > 0 && (
          <div className="ml-auto flex items-center gap-0.5">
            <div ref={modelDropdownRef} className="relative">
              <button
                onClick={() => setModelDropdown(!modelDropdown)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Switch provider / model"
              >
                <span className="max-w-[150px] truncate">
                  {PROVIDERS.find((p) => p.id === provider)?.models.find((m) => m.id === model)?.name || model}
                </span>
                <ChevronDown className="size-3" />
              </button>
              {modelDropdown && (
                <div className="absolute right-0 top-9 z-50 max-h-[60vh] min-w-[220px] overflow-auto rounded-md border bg-popover p-1 shadow-xl">
                  {configuredProviders.map((p) => {
                    const models =
                      p.id === "ollama" && ollamaModels.length > 0
                        ? ollamaModels.map((id) => ({ id, name: id }))
                        : p.models;
                    return (
                      <div key={p.id} className="mb-1 last:mb-0">
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {p.name}
                        </div>
                        {models.map((m) => {
                          const active = provider === p.id && model === m.id;
                          return (
                            <button
                              key={p.id + m.id}
                              onClick={() => void selectModel(p.id, m.id)}
                              className={cn(
                                "flex w-full cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-accent",
                                active && "bg-accent font-medium"
                              )}
                            >
                              <span className="truncate">{m.name}</span>
                              {active && <CheckCircle2 className="size-3.5 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <Tooltip label="New chat">
              <button
                onClick={newChat}
                disabled={streaming}
                aria-label="New chat"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <Plus className="size-4" />
              </button>
            </Tooltip>

            <Tooltip label="Chat history">
              <button
                onClick={() => setHistoryOpen(true)}
                aria-label="Chat history"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <History className="size-4" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Older-version banner */}
      {apiKey && activeChat && activeChat.headOid && currentHead && activeChat.headOid !== currentHead && (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          This chat started from an older version of the project. File contents may differ from what the AI saw.
        </div>
      )}

      {/* Storage-full warning: chat history can no longer be saved. */}
      {quotaWarning && (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          Chat history storage is full — older chats were pruned and new messages may not be saved. Delete old chats from history to free space.
        </div>
      )}

      {/* No API key */}
      {!apiKey && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-foreground text-background">
            <Sparkles className="size-6" />
          </span>
          <div className="space-y-1">
            <div className="text-sm font-medium">Connect an AI provider to continue</div>
            <p className="mx-auto max-w-[18rem] text-xs text-muted-foreground">
              Bring your own API key (OpenAI, Anthropic, Groq, and more) or run a model locally with
              Ollama. The assistant can read &amp; edit files, compile, and verify your PDF.
            </p>
          </div>
          <Button onClick={() => openAISettings()}>
            <Sparkles className="size-4" />
            Connect a provider
          </Button>
          <button
            onClick={() => openAISettings()}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Run a local model with Ollama
          </button>
        </div>
      )}

      {/* Conversation */}
      {apiKey && (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-3 py-3">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-2">
                <p className="text-sm text-muted-foreground">Ask me anything about your project.</p>
                <div className="flex w-full flex-col gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => void send(s)} className="rounded-md border border-sidebar-border bg-accent px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-[color-mix(in_oklch,var(--accent),#000_18%)] hover:text-foreground">{s}</button>
                  ))}
                </div>

                {chats.length > 0 && (
                  <div className="mt-2 flex w-full max-w-[300px] flex-col gap-0.5">
                    <span className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">Recent chats</span>
                    {chats.slice(0, 3).map((chat) => {
                      const stale = chat.headOid && currentHead && chat.headOid !== currentHead;
                      return (
                        <button
                          key={chat.id}
                          onClick={() => openChat(chat)}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                        >
                          <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{chat.title || "New chat"}</span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {new Date(chat.updatedAt).toLocaleDateString()} · {chat.messages.length} msgs
                            </span>
                          </span>
                          {stale && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Older version" />}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setHistoryOpen(true)}
                      className="mt-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <History className="size-3.5" />
                      Show all history ({chats.length})
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Memoized items: only the streaming (last) message re-renders per
                    token; completed messages skip re-parsing their markdown. */}
                {messages.map((msg, i) => (
                  <MessageItem key={i} msg={msg} />
                ))}
                {/* Live shimmer, kept OUT of the memoized items so the frequent
                    thinkingText updates don't reconcile the whole message list. */}
                {streaming &&
                  messages[messages.length - 1]?.role === "assistant" && (
                    <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2">
                      <Shimmer text={thinkingText || "Thinking…"} />
                    </div>
                  )}
              </div>
            )}
          </div>

          {/* Destructive-edit approval prompt (pauses the AI on the tool) */}
          {pendingApproval && (
            <ToolConfirm
              req={pendingApproval.req}
              onApprove={() => pendingApproval.resolve(true)}
              onReject={() => pendingApproval.resolve(false)}
            />
          )}

          {/* Prompt input */}
          <div className="shrink-0 border-t p-2.5">
            <AttachmentChips
              items={attachments}
              onRemove={(id) => setAttachments((a) => a.filter((x) => x.id !== id))}
            />
            <div className="flex items-end gap-2 rounded-lg border bg-background p-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.tex,.bib,.md"
                className="hidden"
                onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach a file or image"
                title="Attach a file or image"
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Paperclip className="size-4" />
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
                placeholder="Ask AI to help with your LaTeX…"
                rows={1}
                className="max-h-32 min-h-[24px] flex-1 resize-none rounded-md bg-transparent pl-2 text-sm outline-none placeholder:text-muted-foreground"
                style={{ height: "auto" }}
                onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 128) + "px"; }}
              />
              {streaming ? (
                <button
                  onClick={stop}
                  aria-label="Stop"
                  title="Stop generating"
                  className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-white transition-colors hover:opacity-90"
                >
                  <Square className="size-3.5 fill-current" />
                </button>
              ) : (
                <button
                  onClick={() => void send(input)}
                  disabled={!input.trim() && attachments.length === 0}
                  aria-label="Send"
                  className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-white transition-colors hover:bg-primary disabled:opacity-40"
                >
                  <ArrowUp className="size-4" />
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <ChatHistoryModal
        open={historyOpen}
        chats={chats}
        activeId={activeChatId}
        currentHead={currentHead}
        onClose={() => setHistoryOpen(false)}
        onOpen={openChat}
        onDelete={(id) => {
          removeChat(id);
          if (id === activeChatId) newChat();
        }}
      />
    </div>
  );
}
