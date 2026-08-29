import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareQuote, Search, Trash2, X } from "lucide-react";
import type { StoredChat } from "@/store/chats";
import { formatUsd } from "@/lib/ai-pricing";
import { chatsSearch } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";

// FTS5 special characters would error inside MATCH; quote each term instead.
function ftsQuery(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((term) => `"${term.replaceAll('"', "")}"`)
    .join(" ");
}

function relativeTime(t: number) {
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

export function ChatHistoryModal({
  open,
  chats,
  activeId,
  currentHead,
  onClose,
  onOpen,
  onDelete,
}: {
  open: boolean;
  chats: StoredChat[];
  activeId: string | null;
  currentHead: string | null;
  onClose: () => void;
  onOpen: (chat: StoredChat) => void;
  onDelete: (chatId: string) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(open, onClose);
  const trimmed = query.trim();
  // Titles filter locally; message content matches come from the library.db
  // session index ("find the chat where…").
  const contentHits = useQuery({
    queryKey: ["chat-content-search", trimmed],
    queryFn: () => chatsSearch(ftsQuery(trimmed)),
    enabled: open && trimmed.length >= 2,
    staleTime: 10_000,
    meta: { silent: true },
  });

  if (!open) return null;
  const matchedIds = new Set((contentHits.data ?? []).map((hit) => hit.chat_id));
  const visibleChats = trimmed
    ? chats.filter(
        (chat) =>
          (chat.title || "").toLowerCase().includes(trimmed.toLowerCase()) ||
          matchedIds.has(chat.id),
      )
    : chats;

  return (
    <div
      className="fixed inset-0 z-[80] flex animate-in fade-in items-center justify-center bg-black/50 p-4 duration-200 backdrop-blur-sm motion-reduce:animate-none"
    >
      <button type="button" aria-label="Close chat history" className="absolute inset-0" onMouseDown={onBackdropMouseDown} />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="chat-history-title"
        className="relative flex h-[min(30rem,80vh)] w-full max-w-lg animate-in flex-col rounded-xl border bg-popover text-popover-foreground shadow-2xl zoom-in-95 fade-in duration-200 motion-reduce:animate-none"
      >
        <div className="flex shrink-0 items-center gap-2 p-4">
          <MessageSquareQuote className="size-4" />
          <h2 id="chat-history-title" className="text-base font-semibold">Chat history</h2>
          <button
            type="button"
            data-modal-initial-focus
            onClick={onClose}
            className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="shrink-0 px-4 pb-2">
          <div className="flex items-center gap-2 rounded-md border bg-background px-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              aria-label="Search chats"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search titles and messages"
              className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {chats.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              No saved chats for this project yet.
            </p>
          ) : visibleChats.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              No chats match that search.
            </p>
          ) : (
            visibleChats.map((chat) => {
              const stale =
                chat.headOid && currentHead && chat.headOid !== currentHead;
              const isActive = chat.id === activeId;
              return (
                <div
                  key={chat.id}
                  className={cn(
                    "group mb-1 flex items-start gap-2 rounded-md px-2.5 py-2 hover:bg-accent/60",
                    isActive && "bg-accent"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(chat)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <MessageSquareQuote className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm font-medium">
                        {chat.title || "New chat"}
                      </span>
                      {stale && (
                        <span
                          title="This chat was started from an older version of the project"
                          className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                        >
                          older version
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 pl-5 text-[11px] text-muted-foreground">
                      {relativeTime(chat.updatedAt)} · {chat.messages.length} msgs
                      {chat.usage &&
                      chat.usage.inputTokens + chat.usage.outputTokens > 0
                        ? ` · ~${(chat.usage.inputTokens + chat.usage.outputTokens).toLocaleString()} tok`
                        : ""}
                      {chat.usage && (chat.usage.estimatedUsd ?? 0) > 0
                        ? ` · ${formatUsd(chat.usage.estimatedUsd ?? 0)}`
                        : ""}
                    </div>
                  </button>
                  {confirmId === chat.id ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          onDelete(chat.id);
                          setConfirmId(null);
                        }}
                        className="rounded bg-destructive px-1.5 py-0.5 text-[11px] font-medium text-destructive-foreground hover:opacity-90"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Delete ${chat.title || "chat"}`}
                      onClick={() => setConfirmId(chat.id)}
                      title="Delete chat"
                      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
