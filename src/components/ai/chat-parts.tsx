import { memo, useEffect, useRef, useState } from "react";
import {
  Brain,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Info,
  Loader2,
  Paperclip,
  Wrench,
  XCircle,
} from "lucide-react";
import type { ChatMessage, ToolEntry } from "@/store/chats";
import { Markdown } from "@/components/ui/markdown";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function Shimmer({ text }: { text?: string }) {
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

// Used for low-urgency notices we don't want to spend a full banner on.
export function InfoHint({ message }: { message: string }) {
  return (
    <Popover ariaLabel={message} trigger={<Info className="size-4" />} className="w-60 p-2.5">
      <p className="text-[11px] leading-relaxed text-muted-foreground">{message}</p>
    </Popover>
  );
}

export function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy message"
      title="Copy message"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="shrink-0 self-center rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function ToolBadge({ tc }: { tc: ToolEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border bg-muted text-xs">
      <button type="button"
        onClick={() => tc.output && setExpanded(!expanded)}
        className={cn("flex w-full items-center gap-2 px-2.5 py-1.5", tc.output && "cursor-pointer hover:bg-accent/50")}
      >
        <Wrench className="size-3.5 text-muted-foreground" />
        <span className="font-mono">{tc.name}</span>
        {tc.approval === "rejected" ? (
          <XCircle className="size-3 text-destructive" />
        ) : (
          <>
            {tc.status === "running" && <Loader2 className="size-3 animate-spin" />}
            {tc.status === "done" && <CheckCircle2 className="size-3 text-emerald-500" />}
            {tc.status === "error" && <XCircle className="size-3 text-destructive" />}
          </>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {tc.approval === "approved" && (
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              Approved
            </span>
          )}
          {tc.approval === "rejected" && (
            <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
              Rejected
            </span>
          )}
          {tc.output && (
            <ChevronRight className={cn("size-3 text-muted-foreground transition-transform", expanded && "rotate-90")} />
          )}
        </span>
      </button>
      {expanded && tc.output && (
        <pre className="max-h-40 overflow-auto border-t px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground">
          {tc.output}
        </pre>
      )}
    </div>
  );
}

export function friendlyHint(text: string, statusCode?: number): string | null {
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
    return "Couldn't reach the AI provider. Check your connection, or if you're using Ollama, make sure it's running (Settings → AI Assistant → Check for Ollama).";
  }
  return null;
}

export function formatError(e: unknown, providerLabel?: string): string {
  const err = typeof e === "object" && e !== null
    ? e as Record<string, unknown>
    : {};
  const statusValue = err.statusCode ?? err.status;
  const statusCode = typeof statusValue === "number" ? statusValue : undefined;
  let bodyMsg = "";
  if (typeof err.responseBody === "string") {
    try {
      const parsed = JSON.parse(err.responseBody) as { error?: { message?: string } };
      bodyMsg = parsed.error?.message ?? err.responseBody;
    } catch {
      bodyMsg = String(err.responseBody);
    }
  }
  // Always keep a compact raw detail (status + provider message) for diagnosis.
  const who = providerLabel ? `${providerLabel}: ` : "";
  const rawDetail =
    bodyMsg && bodyMsg !== err?.message
      ? ` (${bodyMsg.slice(0, 160)}${statusCode ? `, HTTP ${statusCode}` : ""})`
      : statusCode
        ? ` (HTTP ${statusCode})`
        : "";
  const message = typeof err.message === "string" ? err.message : String(e);
  const name = typeof err.name === "string" ? err.name : "";
  const hint = friendlyHint(`${message} ${bodyMsg}`, statusCode);
  if (hint) return `⚠ ${who}${hint}${rawDetail}`;
  const parts: string[] = [`⚠ ${who}`.trimEnd()];
  if (name) parts.push(name);
  if (message) parts.push(message);
  if (statusCode) parts.push(`(HTTP ${statusCode})`);
  if (bodyMsg && bodyMsg !== err?.message) parts.push(`→ ${bodyMsg.slice(0, 300)}`);
  if (parts.length <= 1) parts.push(String(e));
  return parts.join(" ");
}

export function isRetryable(e: unknown): boolean {
  const err = typeof e === "object" && e !== null
    ? e as Record<string, unknown>
    : {};
  const statusValue = err.statusCode ?? err.status;
  const status = typeof statusValue === "number" ? statusValue : undefined;
  if (status && [400, 401, 402, 403, 404, 405, 422].includes(status)) return false;
  const text = `${String(err.message ?? "")} ${String(err.responseBody ?? "")}`.toLowerCase();
  if (
    /insufficient balance|no resource package|out of credit|insufficient[_ ]?quota|billing|payment required|invalid api key|incorrect api key|unauthorized|authentication|no api key|model.*(not found|does not exist|not exist|unavailable)|invalid model|not supported/.test(
      text
    )
  ) {
    return false;
  }
  return true;
}

export const MAX_STEPS = 50;
export const MAX_RETRIES = 4;
export const RETRY_BASE_MS = 800;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Plain text, not markdown, so a long stream stays cheap.
export function ReasoningBlock({
  text,
  active,
  durationMs,
}: {
  text: string;
  active?: boolean;
  durationMs?: number;
}) {
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const open = userToggled ?? !!active;
  const scrollRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    void text;
    if (active && open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text, active, open]);

  const label = active
    ? "Thinking…"
    : durationMs
      ? `Thought for ${Math.max(1, Math.round(durationMs / 1000))}s`
      : "Reasoning";

  return (
    <div className="max-w-[85%] rounded-md border bg-muted text-xs">
      <button
        type="button"
        onClick={() => setUserToggled(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-muted-foreground hover:bg-accent/50"
      >
        <Brain className={cn("size-3.5", active && "animate-pulse")} />
        {active ? <Shimmer text={label} /> : <span>{label}</span>}
        <ChevronRight className={cn("ml-auto size-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <pre
          ref={scrollRef}
          className="max-h-56 overflow-auto whitespace-pre-wrap break-words border-t px-2.5 py-1.5 font-sans text-[11px] leading-relaxed text-muted-foreground"
        >
          {text}
        </pre>
      )}
    </div>
  );
}

// Memoized on the message object reference: `updateLast` only replaces the
// *last* message's reference each streamed token, so every earlier message
// skips re-render (and re-parsing its markdown) instead of reconciling the
// whole list per token.
export const MessageItem = memo(function MessageItem({
  msg,
  live,
}: {
  msg: ChatMessage;
  live?: boolean;
}) {
  const tools = msg.toolCalls ?? [];
  const attachmentOccurrences = new Map<string, number>();
  // Fall back to the legacy single-block fields for chats persisted before
  // reasoningBlocks existed.
  const blocks =
    msg.reasoningBlocks ??
    (msg.reasoning ? [{ text: msg.reasoning, ms: msg.reasoningMs, beforeTool: 0 }] : []);
  // Each block renders before the tool call whose index it recorded, to
  // interleave thinking phases and tool badges in arrival order.
  const rows: React.ReactNode[] = [];
  for (let i = 0; i <= tools.length; i++) {
    blocks.forEach((b, blockIndex) => {
      if (Math.min(b.beforeTool, tools.length) === i) {
        rows.push(
          <ReasoningBlock
            key={b.id ?? `legacy-reasoning-${blockIndex}`}
            text={b.text}
            active={!!live && b.ms === undefined}
            durationMs={b.ms}
          />,
        );
      }
    });
    if (i < tools.length) {
      const tool = tools[i];
      rows.push(<ToolBadge key={tool.id ?? `legacy-tool-${i}`} tc={tool} />);
    }
  }
  return (
    <div className={cn("flex flex-col gap-1.5", msg.role === "user" && "items-end")}>
      {rows}
      {msg.attachments && msg.attachments.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {msg.attachments.map((a) => {
            const identity = `${a.name}:${a.mediaType}`;
            const occurrence = attachmentOccurrences.get(identity) ?? 0;
            attachmentOccurrences.set(identity, occurrence + 1);
            return (
            <span
              key={`${identity}:${occurrence}`}
              className="flex items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              <Paperclip className="size-3" />
              <span className="max-w-[140px] truncate">{a.name}</span>
            </span>
            );
          })}
        </div>
      )}
      {msg.content ? (
        <div
          className={cn(
            "group flex w-full items-center gap-2",
            msg.role === "user" && "justify-end"
          )}
        >
          {msg.role === "user" && <CopyMessageButton text={msg.content} />}
          <div
            className={cn(
              "max-w-[85%] overflow-hidden rounded-lg px-3 py-2 text-sm",
              msg.role === "user" ? "bg-primary text-white" : "bg-muted text-foreground"
            )}
          >
            {msg.role === "assistant" ? (
              <Markdown className="chat-markdown">{msg.content}</Markdown>
            ) : (
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
            )}
          </div>
          {msg.role === "assistant" && <CopyMessageButton text={msg.content} />}
        </div>
      ) : null}
    </div>
  );
});
