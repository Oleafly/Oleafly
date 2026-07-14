import { useToastStore, type ToastAction } from "@/store/toast";
import { logError } from "@/lib/log";

// Works outside React too — not tied to hooks/components.
export const toast = {
  error: (message: string, action?: ToastAction, sticky?: boolean) =>
    useToastStore.getState().push("error", message, action, sticky),
  success: (message: string, action?: ToastAction, sticky?: boolean) =>
    useToastStore.getState().push("success", message, action, sticky),
  info: (message: string, action?: ToastAction, sticky?: boolean) =>
    useToastStore.getState().push("info", message, action, sticky),
  update: (id: number, message: string) => useToastStore.getState().update(id, message),
  dismiss: (id: number) => useToastStore.getState().dismiss(id),
};

// Use this in `catch` blocks for user-triggered actions that would otherwise
// fail silently (`logError` alone writes to `~/.openleaf/app.log` with no
// visible feedback).
export function notifyError(scope: string, e: unknown, message?: string): void {
  void logError(scope, e);
  if (message) {
    toast.error(message);
    return;
  }
  const detail = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  toast.error(detail ? detail : "Something went wrong. See the app log for details.");
}
