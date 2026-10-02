import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareQuote, Search, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { StoredChat } from "@/store/chats";
import { i18n } from "@/i18n";
import { formatUsd } from "@/lib/ai-pricing";
import { formatNumber, formatRelativeTimeFrom } from "@/lib/intl";
import { chatsSearch } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { ModalShell } from "@/components/ui/modal-shell";
import { Badge } from "@/components/ui/badge";

// FTS5 special characters would error inside MATCH; quote each term instead.
function ftsQuery(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((term) => `"${term.replaceAll('"', "")}"`)
    .join(" ");
}

function relativeTime(at: number) {
  return formatRelativeTimeFrom(at, Date.now(), {
    largestUnit: "day",
    dateAfterDays: 7,
    justNow: i18n.t(($) => $.ai.history.relative.justNow),
    format: ({ unit, value: count }) => {
      if (unit === "minute") return i18n.t(($) => $.ai.history.relative.minutes, { count });
      if (unit === "hour") return i18n.t(($) => $.ai.history.relative.hours, { count });
      return i18n.t(($) => $.ai.history.relative.days, { count });
    },
  });
}

export function ChatHistoryModal({
  open,
  chats,
  activeId,
  currentHead,
  onClose,
  onOpen,
  onDelete,
}: Readonly<{
  open: boolean;
  chats: StoredChat[];
  activeId: string | null;
  currentHead: string | null;
  onClose: () => void;
  onOpen: (chat: StoredChat) => void;
  onDelete: (chatId: string) => void;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
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

  const chatRows = () =>
    visibleChats.length === 0 ? (
      <p className="px-3 py-10 text-center text-sm text-muted-foreground">
        {t(($) => $.ai.history.emptySearch)}
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
                  {chat.title || t(($) => $.ai.history.untitled)}
                </span>
                {stale && (
                  <Badge
                    variant="warning"
                    size="sm"
                    title={t(($) => $.ai.history.staleTitle)}
                  >
                    {t(($) => $.ai.history.staleBadge)}
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 pl-5 text-[11px] text-muted-foreground">
                {relativeTime(chat.updatedAt)} ·{" "}
                {t(($) => $.ai.history.messages, { count: chat.messages.length })}
                {chat.usage &&
                chat.usage.inputTokens + chat.usage.outputTokens > 0
                  ? ` · ${t(($) => $.ai.history.tokens, {
                      amount: formatNumber(chat.usage.inputTokens + chat.usage.outputTokens),
                    })}`
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
                  {t(($) => $.common.actions.delete)}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmId(null)}
                  className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
                >
                  {t(($) => $.common.actions.cancel)}
                </button>
              </div>
            ) : (
              <button
                type="button"
                aria-label={t(($) => $.ai.history.deleteAriaLabel, {
                  title: chat.title || t(($) => $.ai.history.deleteFallbackTitle),
                })}
                onClick={() => setConfirmId(chat.id)}
                title={t(($) => $.ai.history.deleteTitle)}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        );
      })
    );

  // Portalled like the other app dialogs. Rendered in place, its z-index only
  // counted inside the workspace panels' stacking context: the title bar stayed
  // undimmed and the editor's pinned rows were drawn over the backdrop.
  return (
    <ModalShell
      open
      onClose={onClose}
      closeLabel={t(($) => $.ai.history.closeBackdrop)}
      portal
      animated
      width="lg"
      labelledBy="chat-history-title"
      className="flex h-[min(30rem,80vh)] flex-col"
    >
      <div className="flex shrink-0 items-center gap-2 p-4">
        <MessageSquareQuote className="size-4" />
        <h2 id="chat-history-title" className="text-base font-semibold">
          {t(($) => $.ai.history.title)}
        </h2>
        <button
          type="button"
          data-modal-initial-focus
          onClick={onClose}
          className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t(($) => $.common.actions.close)}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="shrink-0 px-4 pb-2">
        <div className="flex items-center gap-2 rounded-md border bg-background px-2 transition-colors focus-within:border-ring">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            aria-label={t(($) => $.ai.history.searchLabel)}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(($) => $.ai.history.searchPlaceholder)}
            className="h-8 min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground/70"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {chats.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">
            {t(($) => $.ai.history.emptyProject)}
          </p>
        ) : chatRows()}
      </div>
    </ModalShell>
  );
}
