import type { ComponentType } from "react";
import { AlertTriangle, Check, MessageSquareShare, RotateCcw, X } from "lucide-react";
import { AiChrome } from "@/components/ai/AiChrome";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// One segment of the accept/reject/retry group. Icon-only: the labels live in
// the tooltip and in `aria-label`, so the bar stays narrow enough to sit over a
// wrapped line without covering it. `keyShortcut` is exposed to assistive tech
// via aria-keyshortcuts but deliberately not rendered - the shortcuts still
// work, they just no longer crowd the buttons.
function DiffAction({
  icon: Icon,
  label,
  keyShortcut,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  keyShortcut?: string;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-keyshortcuts={keyShortcut}
        className={cn(
          "inline-flex size-7 items-center justify-center text-primary transition-colors",
          "hover:bg-primary/15 focus-visible:bg-primary/15 focus-visible:outline-none",
        )}
      >
        <Icon className="size-4" />
      </button>
    </Tooltip>
  );
}

export function DiffActionBar({
  onAccept,
  onReject,
  onRetry,
  onOpenInAgent,
}: {
  onAccept: () => void;
  onReject: () => void;
  onRetry: () => void;
  onOpenInAgent?: () => void;
}) {
  return (
    <AiChrome
      borderVariant="animated"
      className="w-fit"
      contentClassName="ai-surface-elevated flex items-center gap-1 p-1 text-popover-foreground"
    >
      {/* Hairline separators instead of gaps, so the three read as one control.
          They go on the group (`divide-x`), not the buttons: Tooltip wraps each
          child in its own span, so a `first:` variant on the button would match
          every one of them and no separator would ever render. */}
      <div className="flex items-center divide-x divide-primary/20 overflow-hidden rounded-md bg-primary/10">
        <DiffAction icon={Check} label="Accept" keyShortcut="Enter" onClick={onAccept} />
        <DiffAction icon={X} label="Reject" keyShortcut="Escape" onClick={onReject} />
        <DiffAction icon={RotateCcw} label="Retry" onClick={onRetry} />
      </div>
      {onOpenInAgent && (
        <Tooltip label="Continue in the AI assistant with full project tools">
          <button
            type="button"
            onClick={onOpenInAgent}
            aria-label="Continue in the AI assistant with full project tools"
            className="inline-flex size-7 items-center justify-center rounded-md text-primary transition-colors hover:bg-primary/15 focus-visible:bg-primary/15 focus-visible:outline-none"
          >
            <MessageSquareShare className="size-4" />
          </button>
        </Tooltip>
      )}
    </AiChrome>
  );
}

export function DiffErrorBar({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    // Primary border, labelled buttons: the animated outline and the icon-only
    // group are reserved for the diff decision, where the choice is the whole
    // point of the widget. This is a message, so it reads as one.
    <AiChrome
      borderVariant="primary"
      className="w-full"
      contentClassName="ai-surface-elevated p-2 text-popover-foreground"
    >
      <p className="flex items-start gap-1.5 text-xs text-destructive">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 break-words">Couldn't generate the edit. {message}</span>
      </p>
      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <RotateCcw className="size-3.5" /> Retry
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
    </AiChrome>
  );
}
