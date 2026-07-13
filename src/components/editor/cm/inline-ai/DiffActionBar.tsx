import { AlertTriangle, Check, MessageSquare, RotateCcw, X } from "lucide-react";
import { AiChrome } from "@/components/ai/AiChrome";

/** Accept / Reject / Retry bar shown while reviewing a proposed inline edit. */
export function DiffActionBar({
  onAccept,
  onReject,
  onRetry,
  onOpenInAgent,
}: {
  onAccept: () => void;
  onReject: () => void;
  onRetry: () => void;
  /** Hand the selection + instruction to the full agent chat with tools. */
  onOpenInAgent?: () => void;
}) {
  return (
    <AiChrome className="w-full" contentClassName="flex flex-wrap items-center gap-1 p-1 text-popover-foreground">
      <button
        type="button"
        onClick={onAccept}
        className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Check className="size-3.5" /> Accept
        <span className="opacity-70">⏎</span>
      </button>
      <button
        type="button"
        onClick={onReject}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
      >
        <X className="size-3.5" /> Reject
        <span className="opacity-70">⎋</span>
      </button>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <RotateCcw className="size-3.5" /> Retry
      </button>
      {onOpenInAgent && (
        <button
          type="button"
          onClick={onOpenInAgent}
          title="Continue in the AI assistant with full project tools"
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <MessageSquare className="size-3.5" /> Open in agent
        </button>
      )}
    </AiChrome>
  );
}

/** Error state: message + retry / dismiss. */
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
    <AiChrome className="w-full" contentClassName="p-2 text-popover-foreground">
      <p className="flex items-start gap-1.5 text-xs text-destructive">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 break-words">Couldn't generate the edit. {message}</span>
      </p>
      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground hover:bg-accent"
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
