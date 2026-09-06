import { History, MessageSquareText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import type { StoredChat } from "@/store/chats";

export function RecentChats({
  chats,
  currentHead,
  limit = 3,
  defaultOpen = false,
  onOpen,
  onShowAll,
}: {
  chats: readonly StoredChat[];
  currentHead: string | null;
  limit?: number;
  defaultOpen?: boolean;
  onOpen: (chat: StoredChat) => void;
  onShowAll: () => void;
}) {
  if (chats.length === 0) return null;
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return (
    <CollapsibleSection
      id="recent-chats"
      icon={History}
      headingLevel="h3"
      defaultOpen={defaultOpen}
      className="w-full border-border/60 bg-card/40"
      title={
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Recent chats
        </span>
      }
      trailing={
        <Badge
          variant="quiet"
          data-testid="recent-chats-count"
          className="min-w-[1.25rem] border-transparent bg-muted-foreground/10 px-1.5 py-0 text-[10px] tabular-nums text-muted-foreground"
        >
          {chats.length}
        </Badge>
      }
    >
      <ul className="-mx-1 flex flex-col">
        {chats.slice(0, limit).map((chat) => {
          const stale = Boolean(chat.headOid && currentHead && chat.headOid !== currentHead);
          const count = chat.messages.length;
          return (
            <li key={chat.id}>
              <button
                type="button"
                onClick={() => onOpen(chat)}
                title={stale ? "Started from an older version of the project" : chat.title || "New chat"}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
              >
                <MessageSquareText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {chat.title || "New chat"}
                </span>
                {stale ? (
                  <span
                    role="img"
                    aria-label="Older version"
                    className="size-1.5 shrink-0 rounded-full bg-amber-500"
                  />
                ) : null}
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {formatter.format(new Date(chat.updatedAt))}
                </span>
                <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/80">
                  {count} {count === 1 ? "msg" : "msgs"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onShowAll}
        className="-mx-1 mt-0.5 flex w-[calc(100%+0.5rem)] items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <History aria-hidden className="size-3.5" />
        Show all history ({chats.length})
      </button>
    </CollapsibleSection>
  );
}
