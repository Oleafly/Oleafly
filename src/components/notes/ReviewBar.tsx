import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AiChrome } from "@/components/ai/AiChrome";
import { DiffAction } from "@/components/editor/cm/inline-ai/DiffActionBar";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

interface ReviewBarProps {
  count: number;
  index: number;
  onPrevious: () => void;
  onNext: () => void;
  onAccept: () => void;
  onReject: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

const STEP =
  "flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent";

export function ReviewBar({
  count,
  index,
  onPrevious,
  onNext,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
}: Readonly<ReviewBarProps>) {
  const { t } = useTranslation(["notes", "editor"]);
  const previous = t(($) => $.editor.diff.previousChange);
  const next = t(($) => $.editor.diff.nextChange);
  return (
    <AiChrome
      borderVariant="animated"
      className="pointer-events-auto mx-auto w-fit"
      contentClassName="ai-surface-elevated flex items-center gap-1 p-1 text-popover-foreground"
    >
      {count > 1 && (
        <>
          <Button variant="ghost" size="xs" onClick={onRejectAll}>
            {t(($) => $.notes.review.rejectAll)}
          </Button>
          <Button variant="ghost" size="xs" onClick={onAcceptAll}>
            {t(($) => $.notes.review.acceptAll)}
          </Button>
          <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
          <Tooltip label={previous}>
            <button type="button" aria-label={previous} className={STEP} onClick={onPrevious}>
              <ArrowLeft aria-hidden className="size-4" />
            </button>
          </Tooltip>
          <span aria-live="polite" className="min-w-8 text-center text-[0.6875rem] tabular-nums">
            <span aria-hidden>
              {index + 1} / {count}
            </span>
            <span className="sr-only">{t(($) => $.notes.review.position, { current: index + 1, total: count })}</span>
          </span>
          <Tooltip label={next}>
            <button type="button" aria-label={next} className={STEP} onClick={onNext}>
              <ArrowRight aria-hidden className="size-4" />
            </button>
          </Tooltip>
        </>
      )}
      <div className="flex items-center divide-x divide-primary/20 overflow-hidden rounded-md bg-primary/10">
        <DiffAction
          icon={Check}
          label={t(($) => $.editor.inlineAi.accept)}
          keyShortcut="Control+Enter Meta+Enter"
          onClick={onAccept}
        />
        <DiffAction icon={X} label={t(($) => $.editor.inlineAi.reject)} keyShortcut="Escape" onClick={onReject} />
      </div>
    </AiChrome>
  );
}
