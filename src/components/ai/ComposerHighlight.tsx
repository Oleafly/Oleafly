import { forwardRef, useMemo } from "react";
import { tokenizeComposer, type ComposerTokenKind } from "@/lib/composer-tokens";
import { cn } from "@/lib/utils";

export const SKILL_TOKEN_CLASS =
  "rounded-[4px] -mx-0.5 px-0.5 bg-blue-500/15 text-blue-700 dark:bg-blue-400/20 dark:text-blue-300";

export const MENTION_TOKEN_CLASS =
  "rounded-[4px] -mx-0.5 px-0.5 bg-teal-500/15 text-teal-700 dark:bg-teal-400/20 dark:text-teal-300";

export function composerTokenClass(kind: ComposerTokenKind): string | undefined {
  if (kind === "skill") return SKILL_TOKEN_CLASS;
  if (kind === "mention") return MENTION_TOKEN_CLASS;
  return undefined;
}

interface ComposerHighlightProps {
  text: string;
  skillIds: readonly string[];
  paths: Iterable<string>;
  className?: string;
}

export const ComposerHighlight = forwardRef<HTMLDivElement, ComposerHighlightProps>(
  ({ text, skillIds, paths, className }, ref) => {
    const tokens = useMemo(
      () => tokenizeComposer(text, { skillIds, paths }),
      [paths, skillIds, text],
    );
    return (
      <div
        ref={ref}
        aria-hidden="true"
        data-testid="ai-composer-highlight"
        className={cn(
          "pointer-events-none absolute inset-0 select-none overflow-hidden whitespace-pre-wrap break-words text-foreground",
          className,
        )}
      >
        {tokens.map((token) => (
          <span
            key={`${token.kind}-${token.start}`}
            data-token={token.kind}
            className={composerTokenClass(token.kind)}
          >
            {text.slice(token.start, token.end)}
          </span>
        ))}
        <span>{"\u200b"}</span>
      </div>
    );
  },
);

ComposerHighlight.displayName = "ComposerHighlight";
