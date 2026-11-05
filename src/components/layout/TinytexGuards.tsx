import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isTauri } from "@tauri-apps/api/core";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { installPhaseLabel, useEngineStore } from "@/store/engine";
import { useTypstToolchainStore } from "@/store/typst-toolchain";
import { cancelQuitFlush, confirmQuitDuringInstall } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import { claimInstallQuitRequests, INSTALL_QUIT_BLOCKED } from "@/lib/quit-flush";

export function TinytexGuards() {
  const { t } = useTranslation(["common", "shell"]);
  const [quitAsked, setQuitAsked] = useState(false);
  const installing = useEngineStore((s) => s.installing);
  const installPhase = useEngineStore((s) => s.installPhase);
  const progress = useEngineStore((s) => s.progress);
  const waitNoticeOpen = useEngineStore((s) => s.installWaitNoticeOpen);
  const closeWaitNotice = useEngineStore((s) => s.closeInstallWaitNotice);
  const cancelInstall = useEngineStore((s) => s.cancelInstall);
  const cancellingInstall = useEngineStore((s) => s.cancellingInstall);
  const typstVersion = useTypstToolchainStore((s) => s.install?.version ?? s.status?.installing ?? null);
  const packageOperation = useEngineStore((s) => s.packageOperations > 0);
  const anyInstalling = installing || typstVersion !== null || packageOperation;

  const native = isTauri();
  useEffect(() => (native ? claimInstallQuitRequests() : undefined), [native]);
  useTauriEvent(
    INSTALL_QUIT_BLOCKED,
    () => {
      setQuitAsked(true);
      const texBusy = () => {
        const engine = useEngineStore.getState();
        return engine.installing || engine.packageOperations > 0;
      };
      if (texBusy() || useTypstToolchainStore.getState().install) return;
      void useTypstToolchainStore
        .getState()
        .refresh()
        .then((status) => {
          if (status?.installing || texBusy()) return;
          if (useTypstToolchainStore.getState().install) return;
          setQuitAsked(false);
          return cancelQuitFlush();
        })
        .catch(() => {});
    },
    native,
  );

  useEffect(() => {
    if (!anyInstalling) {
      setQuitAsked((asked) => {
        if (asked) void cancelQuitFlush().catch(() => {});
        return false;
      });
    }
  }, [anyInstalling]);

  const phaseLabel = installPhaseLabel(installPhase, progress).replace(/…$/, "");
  const confirmQuit = () => {
    void confirmQuitDuringInstall().catch((error) => notifyError("quit during install", error));
  };
  const stay = () => {
    setQuitAsked(false);
    void cancelQuitFlush().catch(() => {});
  };

  return (
    <>
      <ConfirmationDialog
        open={quitAsked && installing}
        title={t(($) => $.shell.tinytexGuards.quit.title)}
        description={t(($) => $.shell.tinytexGuards.quit.description, { phase: phaseLabel })}
        confirmLabel={t(($) => $.shell.tinytexGuards.quit.confirm)}
        destructive
        onConfirm={confirmQuit}
        onCancel={stay}
      />
      <ConfirmationDialog
        open={quitAsked && !installing && typstVersion !== null}
        title={t(($) => $.shell.tinytexGuards.typstQuit.title)}
        description={t(($) => $.shell.tinytexGuards.typstQuit.description, { version: typstVersion ?? "" })}
        confirmLabel={t(($) => $.shell.tinytexGuards.quit.confirm)}
        destructive
        onConfirm={confirmQuit}
        onCancel={stay}
      />
      <ConfirmationDialog
        open={quitAsked && !installing && typstVersion === null && packageOperation}
        title={t(($) => $.shell.tinytexGuards.packageQuit.title)}
        description={t(($) => $.shell.tinytexGuards.packageQuit.description)}
        confirmLabel={t(($) => $.shell.tinytexGuards.quit.confirm)}
        destructive
        onConfirm={confirmQuit}
        onCancel={stay}
      />
      <ConfirmationDialog
        open={waitNoticeOpen && installing}
        title={t(($) => $.shell.tinytexGuards.wait.title)}
        description={t(($) => $.shell.tinytexGuards.wait.description, {
          phase: installPhaseLabel(installPhase, progress),
        })}
        confirmLabel={t(($) => $.common.actions.ok)}
        onConfirm={closeWaitNotice}
        onCancel={closeWaitNotice}
      >
        {installPhase !== "packages" && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={cancellingInstall}
            onClick={() => void cancelInstall()}
          >
            {t(($) => $.shell.tinytexGuards.wait.stop)}
          </Button>
        )}
      </ConfirmationDialog>
    </>
  );
}
