import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CommentBody } from "./comment-body";
import { CommentByline, META } from "./comment-byline";
import { AuthorAvatar, type CommentEntry, type CommentMessageActions, DeletedAvatar, DeliveryNote, useMentioned } from "./comment-entry";
import { isoTime, useCommentKit } from "./comment-kit";
import { ReactionAdd, ReactionError, ReactionPills, useReactions } from "./comment-reactions";

const BUBBLE =
  "min-w-0 w-fit max-w-full rounded-2xl border border-sidebar-border bg-background px-3.5 py-2.5 [overflow-wrap:anywhere]";

const BUBBLE_ACTIONS =
  "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/item:opacity-100 has-[:focus-visible]:opacity-100 has-[[aria-expanded=true]]:opacity-100 pointer-coarse:opacity-100";

const GROUP_GAP_MS = 5 * 60_000;

export interface GroupedMessage {
  author: string;
  verified: boolean;
  at: number;
  deleted: boolean;
}

export function chatGroups(messages: readonly GroupedMessage[]): boolean[] {
  let start: GroupedMessage | null = null;
  return messages.map((next, index) => {
    const previous = messages[index - 1];
    const joins =
      start !== null &&
      !previous.deleted &&
      !next.deleted &&
      next.verified &&
      previous.author === next.author &&
      Math.abs(next.at - start.at) < GROUP_GAP_MS;
    if (!joins) start = next.verified && !next.deleted ? next : null;
    return joins;
  });
}

function BubbleMeta({ entry, own }: Readonly<{ entry: CommentEntry; own: boolean }>) {
  const settled = !entry.deleted && !entry.delivery;
  const named = !own && !(entry.deleted && entry.author.verified);
  if (!named && !settled) return null;
  return (
    <div className={cn("mb-1 flex", own ? "justify-end" : "pl-9")}>
      <CommentByline
        name={named ? entry.author.name : undefined}
        nameClassName={cn("font-medium", META, entry.author.verified ? "text-foreground/80" : "italic")}
        at={settled ? entry.at : 0}
        editedAt={settled ? entry.editedAt : null}
      />
    </div>
  );
}

export function ChatBubble({
  entry,
  own,
  continued,
  fresh,
  canReact,
  react,
  menu,
  editor,
}: Readonly<{
  entry: CommentEntry;
  own: boolean;
  continued: boolean;
  fresh: boolean;
  canReact: boolean;
  react?: CommentMessageActions["react"];
  menu: ReactNode;
  editor: ReactNode;
}>) {
  const kit = useCommentKit();
  const { labels } = kit;
  const settled = !entry.deleted && !entry.delivery;
  const mentioned = useMentioned(kit.members, entry.mentions);
  const reactions = useReactions(
    entry.reactions ?? [],
    canReact && settled,
    react ? (emoji, on) => react(entry.id, emoji, on) : undefined,
  );
  const avatar = (() => {
    if (own) return null;
    if (continued) return <span aria-hidden className="w-7 shrink-0" />;
    if (entry.deleted && entry.author.verified) return <DeletedAvatar size="base" />;
    return <AuthorAvatar author={entry.author} size="base" kit={kit} />;
  })();
  return (
    <>
      {continued && entry.editedAt === null ? null : <BubbleMeta entry={entry} own={own} />}
      <div className={cn("flex items-start gap-2", own && "flex-row-reverse")}>
        {avatar}
        {editor ? (
          <div className="min-w-0 flex-1">{editor}</div>
        ) : (
          <Tooltip label={kit.exact(entry.at)} suppressed={!continued || !settled} className="min-w-0 max-w-[80%]">
            <div
              data-comment-bubble
              className={cn(BUBBLE, entry.deleted && "bg-muted/40 italic text-muted-foreground")}
            >
              {entry.deleted ? (
                <p className="text-[0.8125rem] leading-[1.55]">{entry.removed ? labels.removed : labels.deleted}</p>
              ) : (
                <CommentBody
                  body={entry.body}
                  members={mentioned}
                  className={cn("mt-0", entry.delivery && "text-muted-foreground")}
                />
              )}
              {continued && settled && entry.at ? (
                <time dateTime={isoTime(entry.at)} className="sr-only">
                  {kit.relative(entry.at, kit.now)}
                </time>
              ) : null}
            </div>
          </Tooltip>
        )}
        {editor ? null : (
          <div
            data-comment-bubble-side
            className={cn("relative flex min-w-[3.125rem] shrink-0 items-center self-center", own && "flex-row-reverse")}
          >
            <span data-comment-bubble-actions className={cn(BUBBLE_ACTIONS, own && "flex-row-reverse")}>
              <ReactionAdd state={reactions} bare />
              {menu}
            </span>
            {fresh ? (
              <Badge
                variant="comment"
                size="sm"
                className="pointer-events-none absolute start-0 transition-opacity group-hover/item:opacity-0 group-has-[:focus-visible]/item:opacity-0 pointer-coarse:opacity-0"
              >
                {labels.newBadge}
              </Badge>
            ) : null}
          </div>
        )}
      </div>
      <div className={cn("flex flex-col", own ? "items-end" : "items-start pl-9")}>
        {entry.delivery ? <DeliveryNote entry={entry} delivery={entry.delivery} end={own} /> : null}
        {settled && reactions.shown.length > 0 ? (
          <div data-comment-actions className={cn("mt-1.5 flex flex-wrap items-center gap-1", own && "justify-end")}>
            <ReactionPills state={reactions} />
          </div>
        ) : null}
        <ReactionError state={reactions} className="mt-1.5 basis-auto" />
      </div>
    </>
  );
}
