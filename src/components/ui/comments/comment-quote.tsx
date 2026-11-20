import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Quote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { watchSize } from "./comment-resize";

export type CommentQuoteState = "anchored" | "outdated" | "detached" | "pending";

export interface CommentQuoteLabels {
  showMore: string;
  showLess: string;
  outdated?: string;
}

function useClamped(text: string, expanded: boolean) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const measure = () => setClamped(text !== "" && element.scrollHeight > element.clientHeight + 1);
    measure();
    return watchSize(element, measure);
  }, [text, expanded]);
  return [ref, clamped] as const;
}

export function CommentQuote({
  quote,
  labels,
  state = "anchored",
  active = false,
  title,
  onJump,
  onJumpKeyDown,
  action,
}: Readonly<{
  quote: string;
  labels: CommentQuoteLabels;
  state?: CommentQuoteState;
  active?: boolean;
  title?: string;
  onJump?: () => void;
  onJumpKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  action?: ReactNode;
}>) {
  const [expanded, setExpanded] = useState(false);
  const [ref, clamped] = useClamped(quote, expanded);
  const textId = useId();
  const anchored = state === "anchored";
  const changed = state === "outdated" || state === "detached";
  const focusTint = anchored ? "focus-visible:bg-comment-active" : "focus-visible:bg-accent";
  const text = (
    <span
      ref={ref}
      id={textId}
      data-quote-text
      className={cn(
        "block whitespace-pre-wrap break-words",
        !expanded && "line-clamp-2",
        changed && "line-through",
      )}
    >
      {quote}
    </span>
  );
  const jump = onJump ? (
    <button
      type="button"
      data-thread-jump
      onClick={onJump}
      onKeyDown={onJumpKeyDown}
      className={cn("block w-full rounded-sm text-left transition-colors", focusTint)}
    >
      {text}
    </button>
  ) : null;
  return (
    <div
      data-slot="comment-quote"
      data-quote-state={state}
      className={cn(
        "flex min-w-0 flex-1 items-start gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors",
        anchored ? "text-comment-ink" : "bg-muted text-muted-foreground",
        anchored && (active ? "bg-comment-active" : "bg-comment-highlight"),
      )}
    >
      <Quote
        aria-hidden="true"
        className={cn("mt-0.5 size-3 shrink-0", anchored ? "text-comment-underline" : "text-muted-foreground/60")}
      />
      <div className="min-w-0 flex-1">
        {jump && title ? (
          <Tooltip label={title} className="flex w-full">
            {jump}
          </Tooltip>
        ) : (
          (jump ?? text)
        )}
        {clamped || expanded ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={textId}
            onClick={() => setExpanded((value) => !value)}
            className={cn(
              "mt-0.5 rounded-sm text-[0.6875rem] font-medium transition-colors hover:underline",
              anchored ? "text-comment-ink" : "text-foreground",
              focusTint,
            )}
          >
            {expanded ? labels.showLess : labels.showMore}
          </button>
        ) : null}
      </div>
      {changed && labels.outdated ? (
        <Badge variant="muted" size="sm" className="shrink-0 bg-foreground/5 text-foreground/70">
          {labels.outdated}
        </Badge>
      ) : null}
      {action}
    </div>
  );
}
