import { useEffect } from "react";
import { CircleAlert, CheckCircle2, Info, X } from "lucide-react";
import { useToastStore, type Toast, type ToastKind } from "@/store/toast";
import { cn } from "@/lib/utils";

const DURATION: Record<ToastKind, number> = {
  error: 6000,
  success: 3500,
  info: 4000,
};

/** Toasts with an action button stay longer so the user has time to click. */
const ACTION_BONUS = 4000;

const ICON = {
  error: CircleAlert,
  success: CheckCircle2,
  info: Info,
} as const;

function ToastRow({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {
    if (toast.sticky) return; // stays until the user dismisses it
    const ms = DURATION[toast.kind] + (toast.action ? ACTION_BONUS : 0);
    const id = window.setTimeout(() => dismiss(toast.id), ms);
    return () => window.clearTimeout(id);
  }, [toast.id, toast.kind, toast.action, toast.sticky, dismiss]);

  const Icon = ICON[toast.kind];
  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex w-[min(360px,90vw)] items-start gap-2.5 rounded-lg border bg-popover px-3.5 py-2.5 text-popover-foreground shadow-lg",
        "animate-in fade-in slide-in-from-bottom-2",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          toast.kind === "error" && "text-destructive",
          toast.kind === "success" && "text-emerald-500",
          toast.kind === "info" && "text-muted-foreground",
        )}
      />
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-relaxed">
        {toast.message}
      </p>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            dismiss(toast.id);
          }}
          className="shrink-0 rounded px-2 py-0.5 text-xs font-semibold text-primary hover:bg-primary/10"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss"
        className="-mr-1 -mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * Renders the transient toast stack (bottom-right). Mounted once at the app
 * root so it shows over any view. Fed by `@/lib/toast` / `notifyError`.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} />
      ))}
    </div>
  );
}
