import { AlertTriangle, Check, RotateCcw, X } from "lucide-react";

/** Accept / Reject / Retry bar shown while reviewing a proposed inline edit. */
export function DiffActionBar({
  onAccept,
  onReject,
  onRetry,
}: {
  onAccept: () => void;
  onReject: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex w-full items-center gap-1 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
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
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
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
    </div>
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
    <div className="w-full rounded-lg border bg-popover p-2 text-popover-foreground shadow-md">
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
    </div>
  );
}
