import { Clock, ShieldQuestion, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { META } from "./comment-byline";
import { type CommentKit, useCommentKit } from "./comment-kit";
import type { CommentReaction } from "./comment-reactions";

export interface CommentAuthor {
  id: string;
  name: string;
  imageUrl?: string | null;
  verified: boolean;
}

export type CommentDelivery =
  | { state: "waiting" }
  | { state: "failed"; reason: string; retry?: () => void; discard: () => void };

export interface CommentEntry {
  id: string;
  author: CommentAuthor;
  at: number;
  editedAt: number | null;
  deleted: boolean;
  removed?: boolean;
  body: string;
  mentions: readonly string[];
  reactions?: readonly CommentReaction[];
  delivery?: CommentDelivery;
}

export interface CommentMessageRecord {
  id: string;
  at: number;
  body: string;
  deleted: boolean;
  mentions?: readonly string[] | null;
  reactions?: readonly CommentReaction[] | null;
  pending?: boolean;
  editedAt?: number | null;
  removed?: boolean;
}

export function messageEntry(message: CommentMessageRecord, author: CommentAuthor): CommentEntry {
  return {
    id: message.id,
    author,
    at: message.at,
    editedAt: message.editedAt ?? null,
    deleted: message.deleted,
    removed: message.removed === true,
    body: message.body,
    mentions: message.mentions ?? [],
    reactions: message.reactions ?? [],
    delivery: message.pending && !message.deleted ? { state: "waiting" } : undefined,
  };
}

export interface CommentMessageActions {
  edit?: (messageId: string, body: string) => Promise<void>;
  remove?: (messageId: string) => Promise<void>;
  moderate?: (messageId: string) => Promise<void>;
  react?: (messageId: string, emoji: string, on: boolean) => Promise<void>;
}

export function useMentioned(members: CommentKit["members"], mentions: readonly string[]): CommentKit["members"] {
  return useMemo(() => members.filter((member) => mentions.includes(member.accountId)), [members, mentions]);
}

export function DeletedAvatar({ size }: Readonly<{ size: "sm" | "base" }>) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-px flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
        size === "base" ? "size-7" : "size-5",
      )}
    >
      <Trash2 className={size === "base" ? "size-3.5" : "size-2.5"} />
    </span>
  );
}

export function AuthorAvatar({ author, size, kit }: Readonly<{ author: CommentAuthor; size: "sm" | "base"; kit: CommentKit }>) {
  return (
    <Avatar
      person={{
        id: author.id || "unknown",
        name: author.name,
        imageUrl: author.verified ? author.imageUrl : null,
        hue: kit.hue(author.id || "unknown"),
      }}
      size={size}
      fallbackIcon={author.verified ? undefined : <ShieldQuestion />}
      className={cn("mt-px", !author.verified && "bg-muted text-muted-foreground")}
    />
  );
}

export function DeliveryNote({
  entry,
  delivery,
  end = false,
}: Readonly<{ entry: CommentEntry; delivery: CommentDelivery; end?: boolean }>) {
  const kit = useCommentKit();
  const { labels } = kit;
  if (delivery.state === "waiting") {
    return (
      <span className={cn("flex items-center gap-1", META, end ? "mt-1" : "mt-1.5")}>
        <Clock aria-hidden className="size-3" />
        {labels.waiting}
      </span>
    );
  }
  const copyText = kit.copyText;
  return (
    <div className={cn("space-y-1", end ? "mt-1.5 text-right" : "mt-2.5")}>
      <p className="text-[0.75rem] text-destructive">
        <span className="font-medium">{labels.notSent}</span> {delivery.reason}
      </p>
      <div className={cn("flex flex-wrap items-center gap-1", end && "justify-end")}>
        {delivery.retry ? (
          <Button type="button" variant="ghost" size="xs" className="h-6 px-1.5" onClick={delivery.retry}>
            {labels.retry}
          </Button>
        ) : null}
        {copyText ? (
          <Button type="button" variant="ghost" size="xs" className="h-6 px-1.5" onClick={() => void copyText(entry.body)}>
            {labels.copyText}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="xs" className="h-6 px-1.5" onClick={delivery.discard}>
          {labels.discard}
        </Button>
      </div>
    </div>
  );
}
