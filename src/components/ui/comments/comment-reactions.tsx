import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, SmilePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Popover } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type CommentKit, type CommentReactions, useCommentKit } from "./comment-kit";

export interface CommentReaction {
  emoji: string;
  by: readonly string[];
}

const SETTLE_MS = 8_000;
export const BUMP_MS = 2_500;

function reactionBumps(
  before: ReadonlyMap<string, readonly string[]>,
  reactions: readonly CommentReaction[],
  self: string | null,
): [string, string[]][] {
  return reactions.flatMap((reaction) => {
    const seen = new Set(before.get(reaction.emoji) ?? []);
    const added = reaction.by.filter((id) => id !== self && !seen.has(id));
    return added.length > 0 ? [[reaction.emoji, added] as [string, string[]]] : [];
  });
}

function useBumps(reactions: readonly CommentReaction[], self: string | null): Readonly<Record<string, number>> {
  const before = useRef<Map<string, readonly string[]> | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [people, setPeople] = useState<Readonly<Record<string, readonly string[]>>>({});
  useEffect(() => {
    const previous = before.current;
    before.current = new Map(reactions.map((reaction) => [reaction.emoji, reaction.by]));
    if (previous === null) return;
    const added = reactionBumps(previous, reactions, self);
    if (added.length === 0) return;
    setPeople((current) => {
      const next = { ...current };
      for (const [emoji, ids] of added) next[emoji] = [...new Set([...(current[emoji] ?? []), ...ids])];
      return next;
    });
    for (const [emoji] of added) {
      clearTimeout(timers.current.get(emoji));
      timers.current.set(
        emoji,
        setTimeout(() => {
          timers.current.delete(emoji);
          setPeople(({ [emoji]: _done, ...rest }) => rest);
        }, BUMP_MS),
      );
    }
  }, [reactions, self]);
  useEffect(() => {
    const running = timers.current;
    return () => {
      for (const timer of running.values()) clearTimeout(timer);
      running.clear();
    };
  }, []);
  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const reaction of reactions) {
      const count = (people[reaction.emoji] ?? []).filter((id) => reaction.by.includes(id)).length;
      if (count > 0) counts[reaction.emoji] = count;
    }
    return counts;
  }, [people, reactions]);
}

export function withPending(
  reactions: readonly CommentReaction[],
  pending: Readonly<Record<string, boolean>>,
  self: string | null,
): CommentReaction[] {
  if (self === null) return [...reactions];
  const shown = reactions.map((reaction) => {
    const want = pending[reaction.emoji];
    if (want === undefined) return reaction;
    const others = reaction.by.filter((id) => id !== self);
    return { emoji: reaction.emoji, by: want ? [...others, self] : others };
  });
  for (const [emoji, want] of Object.entries(pending)) {
    if (want && !reactions.some((reaction) => reaction.emoji === emoji)) shown.push({ emoji, by: [self] });
  }
  return shown.filter((reaction) => reaction.by.length > 0);
}

function whoReacted(kit: CommentKit, reaction: CommentReaction): string {
  const others = reaction.by.filter((id) => id !== kit.self).map(kit.nameOf);
  const names = reaction.by.includes(kit.self ?? "") ? [...others, kit.labels.you] : others;
  return kit.labels.reactedBy(kit.listNames(names), reaction.emoji);
}

function ReactionPicker({
  reactions,
  onPick,
  bare = false,
}: Readonly<{ reactions: CommentReactions; onPick: (emoji: string) => void; bare?: boolean }>) {
  const { labels } = useCommentKit();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const pick = (emoji: string) => {
    setOpen(false);
    setAll(false);
    onPick(emoji);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setAll(false);
      }}
      closeOnClick={false}
      ariaLabel={labels.addReaction}
      contentAriaLabel={labels.addReaction}
      triggerClassName={cn(
        "size-6 rounded-full px-0 text-muted-foreground hover:text-foreground",
        !bare && "border border-border",
      )}
      className={cn("min-w-0 rounded-full p-1", all && "w-80 rounded-xl p-2")}
      trigger={<SmilePlus aria-hidden className="size-3.5" />}
    >
      {all && reactions.more ? (
        reactions.more(pick)
      ) : (
        <div className="flex items-center gap-0.5">
          {reactions.quick.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={labels.reactWith(emoji)}
              onClick={() => pick(emoji)}
              className="flex size-8 items-center justify-center rounded-full text-base transition-colors hover:bg-accent focus-visible:bg-accent"
            >
              {emoji}
            </button>
          ))}
          {reactions.more && labels.moreEmoji ? (
            <>
              <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
              <Tooltip label={labels.moreEmoji}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={labels.moreEmoji}
                  className="size-8 rounded-full text-muted-foreground"
                  onClick={() => setAll(true)}
                >
                  <MoreHorizontal aria-hidden className="size-4" />
                </Button>
              </Tooltip>
            </>
          ) : null}
        </div>
      )}
    </Popover>
  );
}

export interface ReactionState {
  kit: CommentKit;
  shown: CommentReaction[];
  bumps: Readonly<Record<string, number>>;
  interactive: boolean;
  error: string | null;
  toggle: (emoji: string, on: boolean) => void;
}

export function useReactions(
  reactions: readonly CommentReaction[],
  canReact: boolean,
  onToggle?: (emoji: string, on: boolean) => Promise<void>,
): ReactionState {
  const kit = useCommentKit();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(() => withPending(reactions, pending, kit.self), [reactions, pending, kit.self]);
  const bumps = useBumps(reactions, kit.self);
  const interactive = canReact && onToggle !== undefined && kit.self !== null && kit.reactions !== undefined;

  useEffect(() => {
    setPending((current) => {
      const left = Object.entries(current).filter(([emoji, want]) => {
        const has = reactions.some((reaction) => reaction.emoji === emoji && reaction.by.includes(kit.self ?? ""));
        return has !== want;
      });
      return left.length === Object.keys(current).length ? current : Object.fromEntries(left);
    });
  }, [reactions, kit.self]);

  useEffect(() => {
    if (Object.keys(pending).length === 0) return;
    const timer = setTimeout(() => setPending({}), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  const toggle = (emoji: string, on: boolean) => {
    if (!onToggle) return;
    setError(null);
    setPending((current) => ({ ...current, [emoji]: on }));
    onToggle(emoji, on).catch((failure: unknown) => {
      setPending((current) => {
        const { [emoji]: _dropped, ...rest } = current;
        return rest;
      });
      setError(kit.describeError(failure));
    });
  };

  return { kit, shown, bumps, interactive, error, toggle };
}

export function ReactionPills({ state }: Readonly<{ state: ReactionState }>) {
  const { kit, shown, bumps, interactive, toggle } = state;
  return shown.map((reaction) => {
    const mine = kit.self !== null && reaction.by.includes(kit.self);
    const pill = cn(
      "relative inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[0.6875rem] tabular-nums text-foreground/85 transition-colors",
      mine ? "border-primary/30 bg-primary/10 text-foreground" : "border-border bg-background",
    );
    const bump = bumps[reaction.emoji];
    const content = (
      <>
        <span aria-hidden className="text-[0.8125rem] leading-none">
          {reaction.emoji}
        </span>
        {reaction.by.length}
        {bump ? (
          <span
            key={bump}
            data-reaction-bump
            className="pointer-events-none absolute -top-2 -right-1.5 rounded-full bg-comment-active px-1 text-[0.5625rem] leading-3.5 font-medium text-comment-ink motion-safe:animate-out motion-safe:fade-out motion-safe:delay-2000 motion-safe:duration-500 motion-safe:fill-mode-forwards"
          >
            {`+${bump}`}
          </span>
        ) : null}
      </>
    );
    return (
      <Tooltip key={reaction.emoji} label={whoReacted(kit, reaction)}>
        {interactive ? (
          <button
            type="button"
            aria-pressed={mine}
            aria-label={whoReacted(kit, reaction)}
            onClick={() => toggle(reaction.emoji, !mine)}
            className={cn(pill, mine ? "hover:bg-primary/15 focus-visible:bg-primary/20" : "hover:bg-accent focus-visible:bg-accent")}
          >
            {content}
          </button>
        ) : (
          <span role="img" aria-label={whoReacted(kit, reaction)} className={pill}>
            {content}
          </span>
        )}
      </Tooltip>
    );
  });
}

export function ReactionAdd({ state, bare }: Readonly<{ state: ReactionState; bare?: boolean }>) {
  const { kit, shown, interactive, toggle } = state;
  if (!interactive || !kit.reactions) return null;
  return (
    <ReactionPicker
      reactions={kit.reactions}
      bare={bare}
      onPick={(emoji) => {
        const already = shown.some((reaction) => reaction.emoji === emoji && reaction.by.includes(kit.self ?? ""));
        if (!already) toggle(emoji, true);
      }}
    />
  );
}

export function ReactionError({ state, className }: Readonly<{ state: ReactionState; className?: string }>) {
  return state.error ? <InlineAlert className={cn("basis-full px-2.5 py-1.5", className)}>{state.error}</InlineAlert> : null;
}

export function ReactionBar({
  reactions,
  canReact,
  onToggle,
}: Readonly<{
  reactions: readonly CommentReaction[];
  canReact: boolean;
  onToggle?: (emoji: string, on: boolean) => Promise<void>;
}>) {
  const state = useReactions(reactions, canReact, onToggle);
  if (state.kit.reactions === undefined && state.shown.length === 0) return null;
  if (!state.interactive && state.shown.length === 0) return null;
  return (
    <>
      <ReactionPills state={state} />
      <ReactionAdd state={state} />
      <ReactionError state={state} />
    </>
  );
}
