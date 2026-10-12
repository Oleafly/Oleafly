import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CollabCommentMember } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { InlineAlert } from "../feedback";
import { peerHue } from "../live/peer-hue";
import { insertMention, matchMembers, mentionQuery } from "./mentions";
import { commentFailure } from "./refusals";

export interface CommentComposerProps {
  label: string;
  submitLabel: string;
  placeholder?: string;
  initial?: string;
  autoFocus?: boolean;
  compact?: boolean;
  members: readonly CollabCommentMember[];
  self: string | null;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
}

function MentionList({
  id,
  label,
  options,
  active,
  self,
  onPick,
  onHover,
}: Readonly<{
  id: string;
  label: string;
  options: readonly CollabCommentMember[];
  active: number;
  self: string | null;
  onPick: (member: CollabCommentMember) => void;
  onHover: (index: number) => void;
}>) {
  return (
    <div
      id={id}
      role="listbox"
      aria-label={label}
      className="absolute left-0 top-full z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
    >
      {options.map((member, index) => (
        <button
          key={member.accountId}
          id={`${id}-${index}`}
          type="button"
          role="option"
          aria-selected={index === active}
          tabIndex={-1}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(member)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
            index === active && "bg-accent text-accent-foreground",
          )}
        >
          <Avatar
            person={{ id: member.accountId, name: member.displayName, hue: peerHue(member.accountId, self) }}
            size="xs"
          />
          <span className="truncate font-medium">{member.displayName}</span>
          {member.login ? <span className="truncate text-muted-foreground">{member.login}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function CommentComposer({
  label,
  submitLabel,
  placeholder,
  initial = "",
  autoFocus = false,
  compact = false,
  members,
  self,
  onSubmit,
  onCancel,
}: Readonly<CommentComposerProps>) {
  const { t } = useTranslation(["collab", "common"]);
  const [body, setBody] = useState(initial);
  const [caret, setCaret] = useState(initial.length);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [highlight, setHighlight] = useState({ key: "", index: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const placeCaret = useRef<number | null>(null);
  const listId = useId();

  const query = mentionQuery(body, caret);
  const start = query?.start ?? null;
  const text = query?.query ?? null;
  const options = useMemo(
    () => (start !== null && text !== null && start !== dismissed ? matchMembers(members, text, self) : []),
    [start, text, dismissed, members, self],
  );
  const open = options.length > 0;
  const queryKey = `${start}:${text}`;
  const active = highlight.key === queryKey ? highlight.index : 0;
  const current = open ? Math.min(active, options.length - 1) : 0;
  const setActive = (index: number) => setHighlight({ key: queryKey, index });

  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);

  useLayoutEffect(() => {
    const position = placeCaret.current;
    if (position === null || !field.current) return;
    placeCaret.current = null;
    field.current.setSelectionRange(position, position);
  });

  const track = (element: HTMLTextAreaElement) => setCaret(element.selectionStart ?? element.value.length);

  const pick = (member: CollabCommentMember) => {
    if (start === null) return;
    const next = insertMention(body, start, caret, member);
    setBody(next.text);
    setCaret(next.caret);
    placeCaret.current = next.caret;
    field.current?.focus();
  };

  const submit = async () => {
    const message = body.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(message);
      setBody("");
      setCaret(0);
    } catch (failure) {
      setError(commentFailure(failure));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const command = event.metaKey || event.ctrlKey;
    if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + options.length) % options.length);
      return;
    }
    if (open && !command && (event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault();
      pick(options[current]);
      return;
    }
    if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(start);
      return;
    }
    if (command && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      void submit();
      return;
    }
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  const showActions = !compact || body.trim() !== "";

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Textarea
          ref={field}
          value={body}
          aria-label={label}
          placeholder={placeholder}
          rows={compact ? 1 : 3}
          readOnly={busy}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${current}` : undefined}
          onChange={(event) => {
            setBody(event.target.value);
            track(event.target);
          }}
          onSelect={(event) => track(event.currentTarget)}
          onKeyDown={onKeyDown}
          className={cn("resize-none px-2 py-1.5 text-xs", compact ? "min-h-8" : "min-h-16")}
        />
        {open ? (
          <MentionList
            id={listId}
            label={t(($) => $.collab.comments.mentionList)}
            options={options}
            active={current}
            self={self}
            onPick={pick}
            onHover={setActive}
          />
        ) : null}
      </div>
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      {showActions ? (
        <div className="flex items-center justify-end gap-1.5">
          {onCancel ? (
            <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
              {t(($) => $.common.actions.cancel)}
            </Button>
          ) : null}
          <Button type="button" size="xs" disabled={busy || body.trim() === ""} onClick={() => void submit()}>
            {submitLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
