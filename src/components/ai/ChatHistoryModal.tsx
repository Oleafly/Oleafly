import { useState } from "react";
import { MessageSquareQuote, Trash2, X } from "lucide-react";
import type { StoredChat } from "@/store/chats";
import { formatUsd } from "@/lib/ai-pricing";
import { cn } from "@/lib/utils";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";

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
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(open, onClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
    >
      <button type="button" aria-label="Close chat history" className="absolute inset-0" onMouseDown={onBackdropMouseDown} />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="chat-history-title"
        className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border bg-sidebar text-sidebar-foreground shadow-2xl"
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b px-4">
          <h2 id="chat-history-title" className="text-sm font-semibold">Chat history</h2>
          <button
            type="button"
            data-modal-initial-focus
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {chats.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              No saved chats for this project yet.
            </p>
          ) : (
            chats.map((chat) => {
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
