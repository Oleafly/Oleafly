import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { cancelQuitFlush, confirmQuitFlush } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { registerUpdateInstallGuard } from "@/lib/update-install-guard";
import { useFilesStore } from "@/store/files";
import { i18n } from "@/i18n";

const QUIT_FLUSH_TIMEOUT_MS = 5_000;

function flushForQuitWithDeadline(): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(i18n.t(($) => $.shell.quitGuard.flushTimeout)));
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
  const { t } = useTranslation(["shell"]);
  const [failure, setFailure] = useState<{ message: string; restart: boolean } | null>(null);
  const flushing = useRef(false);
  const [installing, setInstalling] = useState(false);
  const installingRef = useRef(false);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void registerUpdateInstallGuard((busy) => {
      installingRef.current = busy;
      if (!disposed) setInstalling(busy);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else stop = cleanup;
    }).catch((error) => notifyError("prepare updates", error));
    return () => { disposed = true; stop?.(); };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<boolean>("quit-flush-requested", (event) => {
      const restart = event.payload === true;
      // Repeated Cmd+Q while a flush runs must not start a second flush or
      // stack dialogs; the running flush decides the outcome.
      if (flushing.current || installingRef.current) return;
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
    <>
    <Dialog open={installing}>
      <DialogContent closeDisabled onEscapeKeyDown={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}>
        <DialogTitle>{t(($) => $.shell.quitGuard.installing.title)}</DialogTitle>
        <DialogDescription>{t(($) => $.shell.quitGuard.installing.description)}</DialogDescription>
      </DialogContent>
    </Dialog>
    <ConfirmationDialog
      open={failure !== null}
      title={t(($) => $.shell.quitGuard.failure.title)}
      description={
        failure?.restart
          ? t(($) => $.shell.quitGuard.failure.descriptionRestart, { reason: failure?.message ?? "" })
          : t(($) => $.shell.quitGuard.failure.descriptionQuit, { reason: failure?.message ?? "" })
      }
      confirmLabel={
        failure?.restart
          ? t(($) => $.shell.quitGuard.failure.restartAnyway)
          : t(($) => $.shell.quitGuard.failure.quitAnyway)
      }
      cancelLabel={t(($) => $.shell.quitGuard.failure.stay)}
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
    </>
  );
}
