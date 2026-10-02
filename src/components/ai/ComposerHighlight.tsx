import { forwardRef, useMemo } from "react";
import { tokenizeComposer, type ComposerTokenKind } from "@/lib/composer-tokens";
import { INLINE_TOKEN_BLUE, INLINE_TOKEN_TEAL } from "@/components/ui/inline-token";
import { cn } from "@/lib/utils";

export const SKILL_TOKEN_CLASS = INLINE_TOKEN_BLUE;

export const MENTION_TOKEN_CLASS = INLINE_TOKEN_TEAL;

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
