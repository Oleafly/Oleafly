import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldQuestion } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDateTime, formatRelativeTimeFrom } from "@/lib/intl";
import type { CollabCommentThread, CollabSuggestion } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { CommentComposer } from "../comments/CommentComposer";
import { commentFailure } from "../comments/refusals";
import { MessageRow, moveFocus, type ThreadContext } from "../comments/ThreadCard";
import { InlineAlert } from "../feedback";
import { peerHue } from "../live/peer-hue";
import {
  acceptSuggestions,
  hoverSuggestion,
  openSuggestionIn,
  rejectSuggestions,
  replyToSuggestion,
  selectSuggestion,
  withdrawSuggestions,
} from "./suggestions-store";

export interface SuggestionContext extends ThreadContext {
  canResolve: boolean;
  canSuggest: boolean;
  commentsOn: boolean;
}

function SuggestedText({ suggestion, hue }: Readonly<{ suggestion: CollabSuggestion; hue: number }>) {
  const { t } = useTranslation(["collab"]);
  const insert = suggestion.kind === "insert";
  return (
    <span className="block min-w-0 space-y-0.5">
      <span className="block text-[0.6875rem] font-medium text-muted-foreground">
        {insert ? t(($) => $.collab.suggestions.added) : t(($) => $.collab.suggestions.deleted)}
      </span>
      <span
        data-suggestion-text
        className={cn("block line-clamp-4 whitespace-pre-wrap break-words rounded-sm px-1", !insert && "line-through")}
        style={{ backgroundColor: `hsl(${hue} 85% 55% / ${insert ? 0.2 : 0.1})` }}
      >
        {suggestion.text}
      </span>
    </span>
  );
}

function SuggestionHeader({
  suggestion,
  name,
  imageUrl,
  hue,
  now,
}: Readonly<{
  suggestion: CollabSuggestion;
  name: string;
  imageUrl: string | null | undefined;
  hue: number;
  now: number;
}>) {
  const unverified = !suggestion.verified;
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs">
      <Avatar
        person={{ id: suggestion.author, name, imageUrl, hue }}
        size="sm"
        fallbackIcon={unverified ? <ShieldQuestion /> : undefined}
        className={cn(unverified && "bg-muted text-muted-foreground")}
      />
      <span className={cn("truncate font-medium", unverified && "italic text-muted-foreground")}>{name}</span>
      <Tooltip label={formatDateTime(suggestion.createdAt)} className="shrink-0">
        <time
          dateTime={new Date(suggestion.createdAt).toISOString()}
          className="text-[0.6875rem] text-muted-foreground"
        >
          {formatRelativeTimeFrom(suggestion.createdAt, now)}
        </time>
      </Tooltip>
    </div>
  );
}

function SuggestionActions({
  canResolve,
  canWithdraw,
  busy,
  onAccept,
  onReject,
  onWithdraw,
}: Readonly<{
  canResolve: boolean;
  canWithdraw: boolean;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
  onWithdraw: () => void;
}>) {
  const { t } = useTranslation(["collab"]);
  if (canResolve) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" size="xs" disabled={busy} onClick={onAccept}>
          {t(($) => $.collab.suggestions.accept)}
        </Button>
        <Button type="button" variant="outline" size="xs" disabled={busy} onClick={onReject}>
          {t(($) => $.collab.suggestions.reject)}
        </Button>
      </div>
    );
  }
  if (!canWithdraw) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button type="button" variant="outline" size="xs" disabled={busy} onClick={onWithdraw}>
        {t(($) => $.collab.suggestions.withdraw)}
      </Button>
    </div>
  );
}

export const SuggestionCard = memo(function SuggestionCard({
  suggestion,
  thread,
  selected,
  focus,
  context,
  path,
}: Readonly<{
  suggestion: CollabSuggestion;
  thread: CollabCommentThread | null;
  selected: boolean;
  focus: number;
  context: SuggestionContext;
  path?: string;
}>) {
  const { t } = useTranslation(["collab"]);
  const card = useRef<HTMLElement>(null);
  const seen = useRef(focus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const person = suggestion.verified ? context.people.get(suggestion.author) : undefined;
  const name = suggestion.verified
    ? person?.display_name || t(($) => $.collab.toolbar.unknownPerson)
    : t(($) => $.collab.comments.unverifiedAuthor);
  const label = suggestion.verified
    ? t(($) => $.collab.suggestions.card, { name })
    : t(($) => $.collab.suggestions.unverifiedCard);
  const hue = peerHue(suggestion.author, context.self);
  const own = suggestion.verified && suggestion.author === context.self;

  useEffect(() => {
    if (selected && focus !== seen.current) card.current?.scrollIntoView?.({ block: "nearest" });
    seen.current = focus;
  }, [focus, selected]);

  const run = (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    action()
      .catch((error_: unknown) => setError(commentFailure(error_)))
      .finally(() => setBusy(false));
  };
  const jump = () => (path === undefined ? selectSuggestion(suggestion.id, { reveal: true }) : openSuggestionIn(path, suggestion.id));
  const messages = context.commentsOn && thread ? thread.messages : [];

  return (
    <li>
      <article
        ref={card}
        aria-label={label}
        aria-current={selected ? "true" : undefined}
        data-suggestion-card={suggestion.id}
        onMouseEnter={() => hoverSuggestion(suggestion.id)}
        onMouseLeave={() => hoverSuggestion(null)}
        className={cn(
          "space-y-2 rounded-md border px-2 py-2 transition-colors",
          selected ? "border-primary/30 bg-primary/5" : "border-transparent hover:bg-sidebar-accent/60",
        )}
      >
        <SuggestionHeader
          suggestion={suggestion}
          name={name}
          imageUrl={person?.avatar_url}
          hue={hue}
          now={context.now}
        />
        <Tooltip label={t(($) => $.collab.comments.showInEditor)} className="flex w-full">
          <button
            type="button"
            data-thread-jump
            onClick={jump}
            onKeyDown={moveFocus}
            className="block w-full rounded-sm text-left text-xs text-foreground/85 transition-colors hover:text-foreground focus-visible:bg-accent"
          >
            <SuggestedText suggestion={suggestion} hue={hue} />
          </button>
        </Tooltip>
        <SuggestionActions
          canResolve={context.canResolve}
          canWithdraw={own && context.canSuggest}
          busy={busy}
          onAccept={() => run(() => acceptSuggestions([suggestion.id]))}
          onReject={() => run(() => rejectSuggestions([suggestion.id]))}
          onWithdraw={() => setWithdrawing(true)}
        />
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        {messages.length > 0 && thread ? (
          <ol className="space-y-2">
            {messages.map((message) => (
              <MessageRow key={message.id} thread={thread} message={message} context={context} />
            ))}
          </ol>
        ) : null}
        {context.commentsOn && context.canWrite ? (
          <CommentComposer
            compact
            label={t(($) => $.collab.comments.replyLabel)}
            placeholder={t(($) => $.collab.comments.replyPlaceholder)}
            submitLabel={t(($) => $.collab.comments.reply)}
            members={context.members}
            self={context.self}
            onSubmit={(body) => replyToSuggestion(suggestion, body)}
          />
        ) : null}
      </article>
      <ConfirmationDialog
        open={withdrawing}
        title={t(($) => $.collab.suggestions.withdrawConfirm.title)}
        description={t(($) => $.collab.suggestions.withdrawConfirm.description)}
        confirmLabel={t(($) => $.collab.suggestions.withdrawConfirm.confirm)}
        destructive
        onConfirm={() => {
          setWithdrawing(false);
          run(() => withdrawSuggestions([suggestion.id]));
        }}
        onCancel={() => setWithdrawing(false)}
      />
    </li>
  );
});
