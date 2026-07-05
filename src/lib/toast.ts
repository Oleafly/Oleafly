import { useToastStore } from "@/store/toast";
import { logError } from "@/lib/log";

/** Fire a transient toast from anywhere (outside React too). */
export const toast = {
  error: (message: string) => useToastStore.getState().push("error", message),
  success: (message: string) => useToastStore.getState().push("success", message),
  info: (message: string) => useToastStore.getState().push("info", message),
};

/**
 * Log a caught error to the on-disk app log AND surface it to the user as a
 * toast. Use this in `catch` blocks for user-triggered actions that would
 * otherwise fail silently (`logError` alone writes to `~/.openleaf/app.log`
 * with no visible feedback).
 *
 * @param scope   short context for the log line (e.g. "delete project")
 * @param e       the caught error
 * @param message optional friendly text to show; defaults to the error detail
 */
export function notifyError(scope: string, e: unknown, message?: string): void {
  void logError(scope, e);
  if (message) {
    toast.error(message);
    return;
  }
  const detail = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  toast.error(detail ? detail : "Something went wrong. See the app log for details.");
}
