import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, AtSign, Bold, Code, Italic, List, type LucideIcon, Strikethrough } from "lucide-react";
import { useAutoSizeTextarea } from "@/hooks/use-auto-size-textarea";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Listbox, ListboxOption } from "@/components/ui/listbox";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, isMac, modKey } from "@/lib/utils";
import { useCommentKit } from "./comment-kit";
import { insertAtCaret, type TextEdit, toggleBullets, wrapSelection } from "./comment-markdown";
import { type CommentMember, insertMention, matchMembers, mentionQuery } from "./mentions";

const SUBMIT_KEYS = isMac ? "Meta+Enter" : "Control+Enter";
export const ACTIVITY_IDLE_MS = 6_000;
const ACTIVITY_REFRESH_MS = 2_000;
const FORMATS = ["bold", "italic", "strike", "code"] as const;
const FORMAT_MARKERS: Record<(typeof FORMATS)[number], string> = { bold: "**", italic: "_", strike: "~~", code: "`" };
const FORMAT_ICONS: Record<(typeof FORMATS)[number], LucideIcon> = {
  bold: Bold,
  italic: Italic,
  strike: Strikethrough,
  code: Code,
};

export interface CommentFormatLabels {
  bold: string;
  italic: string;
  strike: string;
  code: string;
  list: string;
  mention: string;
}

export interface CommentComposerLabels {
  mentionList: string;
  hereNow: string;
  cancel: string;
  sending: string;
  enter: string;
  notSent: string;
  retry: string;
  format: CommentFormatLabels;
}

export interface CommentComposerProps {
  label: string;
  submitLabel: string;
  submitIcon?: LucideIcon;
  placeholder?: string;
  initial?: string;
  sending?: Promise<void>;
  autoFocus?: boolean;
  compact?: boolean;
  mentionButton?: boolean;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  onActivity?: (active: boolean) => void;
}

function useActivity(onActivity: ((active: boolean) => void) | undefined, body: string, initial: string): () => void {
  const report = useRef(onActivity);
  const refresh = useRef<ReturnType<typeof setInterval> | null>(null);
  report.current = onActivity;
  const stop = useCallback(() => {
    if (refresh.current === null) return;
    clearInterval(refresh.current);
    refresh.current = null;
    report.current?.(false);
  }, []);
  useEffect(() => {
    if (!report.current) return;
    if (body.trim() === "" || body === initial) {
      stop();
      return;
    }
    if (refresh.current === null) {
      report.current(true);
      refresh.current = setInterval(() => report.current?.(true), ACTIVITY_REFRESH_MS);
    }
    const timer = setTimeout(stop, ACTIVITY_IDLE_MS);
    return () => clearTimeout(timer);
  }, [body, initial, stop]);
  useEffect(() => stop, [stop]);
  return stop;
}

function MentionList({
  id,
  label,
  hereNow,
  options,
  active,
  hue,
  onPick,
  onHover,
}: Readonly<{
  id: string;
  label: string;
  hereNow: string;
  options: readonly CommentMember[];
  active: number;
  hue?: (accountId: string) => number;
  onPick: (member: CommentMember) => void;
  onHover: (index: number) => void;
}>) {
  return (
    <Listbox id={id} aria-label={label} className="absolute left-0 top-full z-50 mt-1 max-h-48 w-full">
      {options.map((member, index) => (
        <ListboxOption
          key={member.accountId}
          id={`${id}-${index}`}
          selected={index === active}
          onHighlight={() => onHover(index)}
          onChoose={() => onPick(member)}
          className="px-2 py-1 text-xs"
        >
          <span className="relative shrink-0">
            <Avatar person={{ id: member.accountId, name: member.displayName, hue: hue?.(member.accountId) }} size="xs" />
            {member.here ? (
              <span
                data-here
                aria-hidden
                className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border-2 border-popover bg-success"
              />
            ) : null}
          </span>
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className="truncate font-medium">{member.displayName}</span>
            <MentionDetail member={member} hereNow={hereNow} />
          </span>
        </ListboxOption>
      ))}
    </Listbox>
  );
}

function MentionDetail({ member, hereNow }: Readonly<{ member: CommentMember; hereNow: string }>) {
  const parts = [member.role, member.here ? hereNow : null].filter((part): part is string => Boolean(part));
  const detail = parts.length > 0 ? parts.join(" · ") : member.login;
  if (!detail) return null;
  return <span className="truncate text-[0.6875rem] text-muted-foreground">{detail}</span>;
}

function FormatButton({
  label,
  icon: Icon,
  onPress,
}: Readonly<{ label: string; icon: LucideIcon; onPress: () => void }>) {
  return (
    <Tooltip label={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        className="size-6 text-muted-foreground hover:text-foreground"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onPress}
      >
        <Icon aria-hidden className="size-3.5" />
      </Button>
    </Tooltip>
  );
}

function ShortcutKeys({ enter, className }: Readonly<{ enter: string; className?: string }>) {
  return (
    <KbdGroup className={className}>
      <Kbd className="h-4 min-w-4 px-1 text-[0.625rem]">{modKey}</Kbd>
      <Kbd className="h-4 min-w-4 px-1 text-[0.625rem]">{enter}</Kbd>
    </KbdGroup>
  );
}

export function CommentComposer({
  label,
  submitLabel,
  submitIcon: SubmitIcon = ArrowUp,
  placeholder,
  initial = "",
  sending,
  autoFocus = false,
  compact = false,
  mentionButton = false,
  onSubmit,
  onCancel,
  onActivity,
}: Readonly<CommentComposerProps>) {
  const { labels, describeError, canRetry, maxLength, members, self, hue } = useCommentKit();
  const [body, setBody] = useState(initial);
  const [caret, setCaret] = useState(initial.length);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [highlight, setHighlight] = useState({ key: "", index: 0 });
  const [busy, setBusy] = useState(sending !== undefined);
  const [failure, setFailure] = useState<{ text: string; retry: boolean } | null>(null);
  const adopted = useRef(sending);
  const field = useRef<HTMLTextAreaElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const placeSelection = useRef<{ start: number; end: number } | null>(null);
  const listId = useId();
  const errorId = useId();

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
    if (!autoFocus || !field.current) return;
    field.current.focus();
    field.current.setSelectionRange(field.current.value.length, field.current.value.length);
  }, [autoFocus]);

  useLayoutEffect(() => {
    const place = placeSelection.current;
    if (place === null || !field.current) return;
    placeSelection.current = null;
    field.current.setSelectionRange(place.start, place.end);
  });

  const track = (element: HTMLTextAreaElement) => setCaret(element.selectionStart ?? element.value.length);

  const apply = (edit: TextEdit) => {
    if (maxLength !== undefined && edit.text.length > maxLength) return;
    setBody(edit.text);
    setCaret(edit.end);
    setDismissed(null);
    placeSelection.current = { start: edit.start, end: edit.end };
    field.current?.focus();
  };

  const selection = () => {
    const element = field.current;
    return { from: element?.selectionStart ?? body.length, to: element?.selectionEnd ?? body.length };
  };

  const format = (kind: (typeof FORMATS)[number]) => {
    const { from, to } = selection();
    apply(wrapSelection(body, from, to, FORMAT_MARKERS[kind]));
  };

  const bullets = () => {
    const { from, to } = selection();
    apply(toggleBullets(body, from, to));
  };

  const mention = () => {
    const { from, to } = selection();
    apply(insertAtCaret(body, from, to, "@"));
  };

  const pick = (member: CommentMember) => {
    if (start === null) return;
    const next = insertMention(body, start, caret, member);
    apply({ text: next.text, start: next.caret, end: next.caret });
  };

  const settle = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      setFailure(null);
      try {
        await work();
        setBody("");
        setCaret(0);
      } catch (error_) {
        setFailure({ text: describeError(error_), retry: canRetry?.(error_) ?? false });
      } finally {
        setBusy(false);
      }
    },
    [describeError, canRetry],
  );

  useEffect(() => {
    const work = adopted.current;
    adopted.current = undefined;
    if (work) void settle(() => work);
  }, [settle]);

  const submit = async () => {
    const message = body.trim();
    if (!message || busy) return;
    await settle(() => onSubmit(message));
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
    if (command && !event.shiftKey && !event.altKey && (event.key === "b" || event.key === "i")) {
      event.preventDefault();
      format(event.key === "b" ? "bold" : "italic");
      return;
    }
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      event.stopPropagation();
      if (body.trim() === "" || body === initial) onCancel();
      else field.current?.blur();
    }
  };

  const quiet = useActivity(onActivity, body, initial);
  useAutoSizeTextarea(field, shell, body, placeholder ?? "", 192);
  const empty = body.trim() === "";

  return (
    <div className="space-y-1.5">
      <div
        ref={shell}
        data-composer-state={busy ? "sending" : failure ? "failed" : "idle"}
        className={cn(
          "relative rounded-lg border bg-background transition-colors focus-within:border-ring",
          failure && "border-destructive/40",
          busy && "bg-muted/40",
        )}
      >
        <textarea
          ref={field}
          value={body}
          aria-label={label}
          aria-describedby={failure ? errorId : undefined}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={compact ? 1 : 2}
          readOnly={busy}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${current}` : undefined}
          onChange={(event) => {
            setBody(event.target.value);
            track(event.target);
          }}
          onSelect={(event) => track(event.currentTarget)}
          onBlur={quiet}
          onKeyDown={onKeyDown}
          className={cn(
            "block w-full resize-none bg-transparent px-2.5 pt-2 pb-1 text-[0.8125rem] text-foreground placeholder:text-muted-foreground",
            compact ? "min-h-8" : "min-h-12",
            busy && "text-muted-foreground",
          )}
        />
        {open ? (
          <MentionList
            id={listId}
            label={labels.mentionList}
            hereNow={labels.hereNow}
            options={options}
            active={current}
            hue={hue}
            onPick={pick}
            onHover={setActive}
          />
        ) : null}
        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          {FORMATS.map((kind) => (
            <FormatButton
              key={kind}
              label={labels.format[kind]}
              icon={FORMAT_ICONS[kind]}
              onPress={() => format(kind)}
            />
          ))}
          <FormatButton label={labels.format.list} icon={List} onPress={bullets} />
          {mentionButton && members.length > 0 ? (
            <>
              <span aria-hidden className="mx-1 h-4 w-px bg-border" />
              <FormatButton label={labels.format.mention} icon={AtSign} onPress={mention} />
            </>
          ) : null}
          <span aria-hidden className="flex-1" />
          {busy ? (
            <span role="status" className="px-1 text-[0.6875rem] text-muted-foreground">
              {labels.sending}
            </span>
          ) : null}
          {onCancel ? (
            <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
              {labels.cancel}
            </Button>
          ) : null}
          <Tooltip
            label={
              <span className="flex items-center gap-1.5">
                {submitLabel}
                <ShortcutKeys enter={labels.enter} />
              </span>
            }
          >
            <Button
              type="button"
              size="icon"
              aria-label={submitLabel}
              aria-keyshortcuts={SUBMIT_KEYS}
              aria-disabled={busy || empty}
              className={cn(
                "size-7 shrink-0 rounded-full",
                empty && !busy && "cursor-default bg-muted text-muted-foreground hover:bg-muted focus-visible:bg-muted",
              )}
              onClick={() => {
                if (!busy && !empty) void submit();
              }}
            >
              {busy ? <Spinner size="xs" /> : <SubmitIcon aria-hidden className="size-4" />}
            </Button>
          </Tooltip>
        </div>
      </div>
      {failure ? (
        <div className="flex items-start gap-1.5">
          <InlineAlert id={errorId} className="flex min-w-0 flex-1 flex-wrap gap-x-1 px-2.5 py-1.5">
            <span className="font-medium">{labels.notSent}</span>
            <span>{failure.text}</span>
          </InlineAlert>
          {failure.retry ? (
            <Button type="button" variant="ghost" size="xs" className="shrink-0" onClick={() => void submit()}>
              {labels.retry}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
