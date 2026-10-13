import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Quote } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function useClamped(text: string, expanded: boolean) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    void text;
    const measure = () => setClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);
  return [ref, clamped] as const;
}

export function CommentQuote({
  quote,
  title,
  onJump,
  onJumpKeyDown,
}: Readonly<{
  quote: string;
  title?: string;
  onJump?: () => void;
  onJumpKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}>) {
  const { t } = useTranslation(["common"]);
  const [expanded, setExpanded] = useState(false);
  const [ref, clamped] = useClamped(quote, expanded);
  const textClass = cn("whitespace-pre-wrap break-words", !expanded && "line-clamp-3");
  const text = (
    <span ref={ref} data-quote-text className={cn("block", textClass)}>
      {quote}
    </span>
  );
  const jump = onJump ? (
    <button
      type="button"
      data-thread-jump
      onClick={onJump}
      onKeyDown={onJumpKeyDown}
      className="block w-full rounded-sm text-left transition-colors hover:text-foreground focus-visible:bg-amber-500/15 focus-visible:text-foreground"
    >
      {text}
    </button>
  ) : null;
  return (
    <div
      data-slot="comment-quote"
      className="flex min-w-0 flex-1 gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-foreground/85 dark:bg-amber-400/10"
    >
      <Quote aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1">
        {jump && title ? (
          <Tooltip label={title} className="flex w-full">
            {jump}
          </Tooltip>
        ) : (
          jump ?? text
        )}
        {clamped || expanded ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="mt-0.5 rounded-sm text-[0.6875rem] font-medium text-amber-700 transition-colors hover:text-amber-800 focus-visible:bg-amber-500/15 dark:text-amber-300 dark:hover:text-amber-200"
          >
            {expanded ? t(($) => $.common.actions.showLess) : t(($) => $.common.actions.showMore)}
          </button>
        ) : null}
      </div>
    </div>
  );
}
