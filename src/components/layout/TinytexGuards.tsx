import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isTauri } from "@tauri-apps/api/core";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { installPhaseLabel, useEngineStore } from "@/store/engine";
import { useTypstToolchainStore } from "@/store/typst-toolchain";
import { cancelQuitFlush, confirmQuitDuringInstall } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import { claimInstallQuitRequests, INSTALL_QUIT_BLOCKED } from "@/lib/quit-flush";

/**
 * Two guards around a running TinyTeX install:
 *
 * - Quit interception: the Rust side blocks window close / Cmd+Q while an
 *   install runs and emits `tinytex-quit-blocked`; the user confirms before
 *   the app really exits. The partial download survives and resumes.
 * - Recompile notice: compiling while the install runs queues the compile and
 *   tells the user it will start as soon as the engine is ready.
 */
export function TinytexGuards() {
  const { t } = useTranslation(["common", "shell"]);
  const [quitAsked, setQuitAsked] = useState(false);
  const installing = useEngineStore((s) => s.installing);
  const installPhase = useEngineStore((s) => s.installPhase);
  const progress = useEngineStore((s) => s.progress);
  const waitNoticeOpen = useEngineStore((s) => s.installWaitNoticeOpen);
  const closeWaitNotice = useEngineStore((s) => s.closeInstallWaitNotice);
  const typstVersion = useTypstToolchainStore((s) => s.install?.version ?? s.status?.installing ?? null);
  const anyInstalling = installing || typstVersion !== null;

  const native = isTauri();
  useEffect(() => (native ? claimInstallQuitRequests() : undefined), [native]);
  useTauriEvent(
    INSTALL_QUIT_BLOCKED,
    () => {
      setQuitAsked(true);
      if (useEngineStore.getState().installing || useTypstToolchainStore.getState().install) return;
      void useTypstToolchainStore
        .getState()
        .refresh()
        .then((status) => {
          if (status?.installing || useEngineStore.getState().installing) return;
          if (useTypstToolchainStore.getState().install) return;
          setQuitAsked(false);
          void cancelQuitFlush().catch(() => {});
        });
    },
    native,
  );

  // The install finished (or failed) while the dialog was up: quitting is no
  // longer destructive, so stop asking — and re-arm the quit flush gate. The
  // quit attempt that opened this dialog already confirmed its flush; if the
  // user now stays and keeps editing, the next quit must flush again.
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
  // This dialog can be reached after the quit flush confirmed; staying
  // must re-arm the flush gate or the next quit would skip saving.
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
        open={waitNoticeOpen && installing}
        title={t(($) => $.shell.tinytexGuards.wait.title)}
        description={t(($) => $.shell.tinytexGuards.wait.description, {
          phase: installPhaseLabel(installPhase, progress),
        })}
        confirmLabel={t(($) => $.common.actions.ok)}
        onConfirm={closeWaitNotice}
        onCancel={closeWaitNotice}
      />
    </>
  );
}
