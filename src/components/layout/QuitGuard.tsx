import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { cancelQuitFlush, confirmQuitFlush } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import { useFilesStore } from "@/store/files";

const QUIT_FLUSH_TIMEOUT_MS = 5_000;

function flushForQuitWithDeadline(): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("Saving did not finish within 5 seconds."));
    }, QUIT_FLUSH_TIMEOUT_MS);
  });
  return Promise.race([useFilesStore.getState().flushForQuit(), deadline]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}

/**
 * Transactional quit: the Rust side blocks window close, Cmd+Q, and Restart
 * while dirty buffers may exist and emits `quit-flush-requested` (payload:
 * whether a restart, not a quit, is wanted). This guard runs the same durable
 * flush that project close/switch uses, then confirms the quit. When a save
 * fails the quit is blocked and the user chooses between staying (default)
 * and quitting anyway with unsaved changes.
 */
export function QuitGuard() {
  const [failure, setFailure] = useState<{ message: string; restart: boolean } | null>(null);
  const flushing = useRef(false);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<boolean>("quit-flush-requested", (event) => {
      const restart = event.payload === true;
      // Repeated Cmd+Q while a flush runs must not start a second flush or
      // stack dialogs; the running flush decides the outcome.
      if (flushing.current) return;
      flushing.current = true;
      flushForQuitWithDeadline()
        .then(() => confirmQuitFlush(restart))
        .catch((error: unknown) => {
          setFailure({
            message: error instanceof Error ? error.message : String(error),
            restart,
          });
        })
        .finally(() => {
          flushing.current = false;
        });
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return (
    <ConfirmationDialog
      open={failure !== null}
      title="Some files could not be saved"
      description={`${failure?.message ?? ""} Your unsaved changes are kept open. Stay to fix the problem, or ${failure?.restart ? "restart" : "quit"} anyway and lose them.`}
      confirmLabel={failure?.restart ? "Restart anyway" : "Quit anyway"}
      cancelLabel="Stay"
      destructive
      onConfirm={() => {
        const restart = failure?.restart ?? false;
        setFailure(null);
        void confirmQuitFlush(restart).catch((error) => notifyError("quit anyway", error));
      }}
      onCancel={() => {
        setFailure(null);
        void cancelQuitFlush().catch((error) => notifyError("stay after failed save", error));
      }}
    />
  );
}
