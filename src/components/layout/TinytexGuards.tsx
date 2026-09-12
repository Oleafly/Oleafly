import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { installPhaseLabel, useEngineStore } from "@/store/engine";
import { cancelQuitFlush, confirmQuitDuringInstall } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";

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

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen("tinytex-quit-blocked", () => setQuitAsked(true)).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // The install finished (or failed) while the dialog was up: quitting is no
  // longer destructive, so stop asking — and re-arm the quit flush gate. The
  // quit attempt that opened this dialog already confirmed its flush; if the
  // user now stays and keeps editing, the next quit must flush again.
  useEffect(() => {
    if (!installing) {
      setQuitAsked((asked) => {
        if (asked) void cancelQuitFlush().catch(() => {});
        return false;
      });
    }
  }, [installing]);

  const phaseLabel = installPhaseLabel(installPhase, progress).replace(/…$/, "");

  return (
    <>
      <ConfirmationDialog
        open={quitAsked && installing}
        title={t(($) => $.shell.tinytexGuards.quit.title)}
        description={t(($) => $.shell.tinytexGuards.quit.description, { phase: phaseLabel })}
        confirmLabel={t(($) => $.shell.tinytexGuards.quit.confirm)}
        destructive
        onConfirm={() => {
          void confirmQuitDuringInstall().catch((error) =>
            notifyError("quit during install", error),
          );
        }}
        onCancel={() => {
          setQuitAsked(false);
          // This dialog can be reached after the quit flush confirmed; staying
          // must re-arm the flush gate or the next quit would skip saving.
          void cancelQuitFlush().catch(() => {});
        }}
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
