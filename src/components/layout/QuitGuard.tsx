import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isTauri } from "@tauri-apps/api/core";
import { useTauriEvent, useTauriSubscription } from "@/hooks/use-tauri-event";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { cancelQuitFlush, confirmQuitFlush, reloadViews } from "@/lib/tauri";
import { logError } from "@/lib/log";
import { notifyError } from "@/lib/toast";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { registerUpdateInstallGuard } from "@/lib/update-install-guard";
import {
  answerQuitRequest,
  claimQuitRequests,
  flushForQuitWithDeadline,
  QUIT_FLUSH_REQUESTED,
} from "@/lib/quit-flush";

function holdQuitAfterFailedSave() {
  return cancelQuitFlush().catch((cancelError) => logError("hold quit after failed save", cancelError));
}

function stayForRunningTerminals() {
  return cancelQuitFlush().catch((cancelError) => logError("stay for running terminals", cancelError));
}

const RELOAD_VIEWS_REQUESTED = "menu://reload-views";

type LeaveAction = "quit" | "restart" | "reload";

function actionFor(restart: boolean): LeaveAction {
  return restart ? "restart" : "quit";
}

async function terminalsMayStop(action: LeaveAction): Promise<boolean> {
  try {
    const { confirmStopTerminals } = await import("@/lib/terminal-lifecycle");
    return await confirmStopTerminals({ reason: action });
  } catch (error) {
    void logError("ask about running terminals", error);
    return true;
  }
}

async function leaveOnceTerminalsMayStop(action: LeaveAction): Promise<void> {
  if (!(await terminalsMayStop(action))) {
    if (action !== "reload") await stayForRunningTerminals();
    return;
  }
  if (action === "reload") await reloadViews();
  else await confirmQuitFlush(action === "restart");
}

export function QuitGuard() {
  const { t } = useTranslation(["shell"]);
  const [failure, setFailure] = useState<{ message: string; action: LeaveAction } | null>(null);
  const [installing, setInstalling] = useState(false);
  const installingRef = useRef(false);
  const native = isTauri();
  const guardInstalls = useCallback(
    () =>
      registerUpdateInstallGuard((busy) => {
        installingRef.current = busy;
        setInstalling(busy);
      }),
    [],
  );
  useTauriSubscription(native ? guardInstalls : null, "prepare updates");

  useEffect(() => (native ? claimQuitRequests() : undefined), [native]);

  const saveThenLeave = (action: LeaveAction) =>
    answerQuitRequest(() =>
      flushForQuitWithDeadline()
        .then(() => leaveOnceTerminalsMayStop(action))
        .catch(async (error: unknown) => {
          setFailure({
            message: error instanceof Error ? error.message : String(error),
            action,
          });
          if (action !== "reload") await holdQuitAfterFailedSave();
        }),
    );

  useTauriEvent<boolean>(
    QUIT_FLUSH_REQUESTED,
    (payload) => {
      if (installingRef.current) return;
      saveThenLeave(actionFor(payload === true));
    },
    native,
  );

  useTauriEvent(
    RELOAD_VIEWS_REQUESTED,
    () => {
      if (installingRef.current) return;
      saveThenLeave("reload");
    },
    native,
  );

  const reason = failure?.message ?? "";
  const failureCopy = {
    quit: {
      description: t(($) => $.shell.quitGuard.failure.descriptionQuit, { reason }),
      confirm: t(($) => $.shell.quitGuard.failure.quitAnyway),
    },
    restart: {
      description: t(($) => $.shell.quitGuard.failure.descriptionRestart, { reason }),
      confirm: t(($) => $.shell.quitGuard.failure.restartAnyway),
    },
    reload: {
      description: t(($) => $.shell.quitGuard.failure.descriptionReload, { reason }),
      confirm: t(($) => $.shell.quitGuard.failure.reloadAnyway),
    },
  }[failure?.action ?? "quit"];

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
      description={failureCopy.description}
      confirmLabel={failureCopy.confirm}
      cancelLabel={t(($) => $.shell.quitGuard.failure.stay)}
      destructive
      onConfirm={() => {
        const action = failure?.action ?? "quit";
        setFailure(null);
        void leaveOnceTerminalsMayStop(action).catch((error) =>
          notifyError(action === "reload" ? "reload anyway" : "quit anyway", error),
        );
      }}
      onCancel={() => {
        const action = failure?.action;
        setFailure(null);
        if (action === "reload") return;
        void cancelQuitFlush().catch((error) => logError("stay after failed save", error));
      }}
    />
    </>
  );
}
