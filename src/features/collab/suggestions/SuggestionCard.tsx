import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldQuestion } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { CommentByline } from "@/components/ui/comments/comment-byline";
import type { CommentAuthor } from "@/components/ui/comments/comment-entry";
import { commentCardClass } from "@/components/ui/comments/comment-thread";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import type { CollabCommentThread, CollabSuggestion } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { CommentComposer } from "@/components/ui/comments/comment-composer";
import { commentFailure } from "../comments/refusals";
import { authorFor, EmbeddedThread, moveFocus, type ThreadContext, useAuthorNames } from "../comments/ThreadCard";
import { InlineAlert } from "../feedback";
import { type PeerHueBackend, peerHue } from "../live/peer-hue";
import {
  acceptSuggestions,
  groupIds,
  hoverSuggestion,
  openSuggestionIn,
  rejectSuggestions,
  replyToSuggestion,
  selectSuggestion,
  withdrawSuggestions,
} from "./suggestions-store";

export interface SuggestionContext extends ThreadContext {
  backend: PeerHueBackend;
  canResolve: boolean;
  canSuggest: boolean;
  commentsOn: boolean;
  suggestionThreads: boolean;
}

function ChangedText({ text, hue, insert }: Readonly<{ text: string; hue: number; insert: boolean }>) {
  return (
    <span
      data-suggestion-text
      className={cn("block line-clamp-4 whitespace-pre-wrap break-words rounded-sm px-1", !insert && "line-through")}
      style={{ backgroundColor: `hsl(${hue} 85% 55% / ${insert ? 0.2 : 0.1})` }}
    >
      {text}
    </span>
  );
}

function SuggestedText({
  suggestion,
  replaced,
  hue,
}: Readonly<{ suggestion: CollabSuggestion; replaced: CollabSuggestion | null; hue: number }>) {
  const { t } = useTranslation(["collab"]);
  const insert = suggestion.kind === "insert";
  const label = "block text-[0.6875rem] font-medium text-muted-foreground";
  if (replaced && /\S/.test(replaced.text)) {
    return (
      <span className="block min-w-0 space-y-0.5">
        <span className={label}>{t(($) => $.collab.suggestions.replaced)}</span>
        <ChangedText text={replaced.text} hue={hue} insert={false} />
        <span className={label}>{t(($) => $.collab.suggestions.replacedWith)}</span>
        <ChangedText text={suggestion.text} hue={hue} insert />
      </span>
    );
  }
  return (
    <span className="block min-w-0 space-y-0.5">
      <span className={label}>
        {insert ? t(($) => $.collab.suggestions.added) : t(($) => $.collab.suggestions.deleted)}
      </span>
      <ChangedText text={suggestion.text} hue={hue} insert={insert} />
    </span>
  );
}

function SuggestionHeader({
  suggestion,
  author,
  hue,
}: Readonly<{
  suggestion: CollabSuggestion;
  author: CommentAuthor;
  hue: number;
}>) {
  const unverified = !author.verified;
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs">
      <Avatar
        person={{ id: author.id, name: author.name, imageUrl: author.imageUrl, hue }}
        size="sm"
        fallbackIcon={unverified ? <ShieldQuestion /> : undefined}
        className={cn(unverified && "bg-muted text-muted-foreground")}
      />
      <CommentByline
        name={author.name}
        nameClassName={cn("font-medium", unverified && "italic text-muted-foreground")}
        note={author.note}
        at={suggestion.createdAt}
      />
    </div>
  );
}

export function AcceptButton({
  canAccept,
  disabled,
  onClick,
  variant,
  children,
}: Readonly<{
  canAccept: boolean;
  disabled: boolean;
  onClick: () => void;
  variant?: "outline";
  children: ReactNode;
}>) {
  const { t } = useTranslation(["collab"]);
  const button = (
    <Button type="button" variant={variant} size="xs" disabled={disabled || !canAccept} onClick={onClick}>
      {children}
    </Button>
  );
  if (canAccept) return button;
  return (
    <Tooltip label={t(($) => $.collab.suggestions.acceptOffServer)} wide className="inline-flex">
      {button}
    </Tooltip>
  );
}

function SuggestionActions({
  canResolve,
  canAccept,
  canWithdraw,
  busy,
  onAccept,
  onReject,
  onWithdraw,
}: Readonly<{
  canResolve: boolean;
  canAccept: boolean;
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
        <AcceptButton canAccept={canAccept} disabled={busy} onClick={onAccept}>
          {t(($) => $.collab.suggestions.accept)}
        </AcceptButton>
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
  replaced = null,
  thread,
  selected,
  focus,
  context,
  canAccept = true,
  path,
}: Readonly<{
  suggestion: CollabSuggestion;
  replaced?: CollabSuggestion | null;
  thread: CollabCommentThread | null;
  selected: boolean;
  focus: number;
  context: SuggestionContext;
  canAccept?: boolean;
  path?: string;
}>) {
  const { t } = useTranslation(["collab"]);
  const card = useRef<HTMLElement>(null);
  const seen = useRef(focus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const names = useAuthorNames();
  const author = authorFor(
    suggestion,
    suggestion.verified ? context.people.get(suggestion.author) : undefined,
    names,
  );
  const label = suggestion.verified
    ? t(($) => $.collab.suggestions.card, { name: author.name })
    : t(($) => $.collab.suggestions.unverifiedCard);
  const hue = peerHue(suggestion.author, context.self, context.backend);
  const own = suggestion.verified && suggestion.author === context.self;
  const ids = groupIds({ suggestion, replaced });

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
        data-suggestion-replaced={replaced?.id}
        onMouseEnter={() => hoverSuggestion(suggestion.id)}
        onMouseLeave={() => hoverSuggestion(null)}
        className={cn("space-y-3", commentCardClass(selected))}
      >
        <SuggestionHeader suggestion={suggestion} author={author} hue={hue} />
        <Tooltip label={t(($) => $.collab.comments.showInEditor)} className="flex w-full">
          <button
            type="button"
            data-thread-jump
            onClick={jump}
            onKeyDown={moveFocus}
            className="block w-full rounded-sm text-left text-xs text-foreground/85 transition-colors hover:text-foreground focus-visible:bg-accent"
          >
            <SuggestedText suggestion={suggestion} replaced={replaced} hue={hue} />
          </button>
        </Tooltip>
        <SuggestionActions
          canResolve={context.canResolve}
          canAccept={canAccept}
          canWithdraw={own && context.canSuggest}
          busy={busy}
          onAccept={() => run(() => acceptSuggestions(ids))}
          onReject={() => run(() => rejectSuggestions(ids))}
          onWithdraw={() => setWithdrawing(true)}
        />
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        {messages.length > 0 && thread ? (
          <EmbeddedThread thread={thread} context={context} />
        ) : context.commentsOn && context.canWrite && context.suggestionThreads ? (
          <CommentComposer
            compact
            label={t(($) => $.collab.comments.replyLabel)}
            placeholder={t(($) => $.collab.comments.replyPlaceholder)}
            submitLabel={t(($) => $.collab.comments.send)}
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
          run(() => withdrawSuggestions(ids));
        }}
        onCancel={() => setWithdrawing(false)}
      />
    </li>
  );
});
