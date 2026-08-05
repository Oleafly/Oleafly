import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { installPhaseLabel, useEngineStore } from "@/store/engine";
import { confirmQuitDuringInstall } from "@/lib/tauri";
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
  // longer destructive, so stop asking.
  useEffect(() => {
    if (!installing) setQuitAsked(false);
  }, [installing]);

  const phaseLabel = installPhaseLabel(installPhase, progress).replace(/…$/, "");

  return (
    <>
      <ConfirmationDialog
        open={quitAsked && installing}
        title="TinyTeX is still installing"
        description={`${phaseLabel} right now. If you quit, the install pauses — the downloaded part is kept and resumes the next time you open Oleafly.`}
        confirmLabel="Quit anyway"
        destructive
        onConfirm={() => {
          void confirmQuitDuringInstall().catch((error) =>
            notifyError("quit during install", error),
          );
        }}
        onCancel={() => setQuitAsked(false)}
      />
      <ConfirmationDialog
        open={waitNoticeOpen && installing}
        title="TinyTeX is still downloading"
        description={`${installPhaseLabel(installPhase, progress)} Your compile is queued and starts automatically as soon as the engine is ready.`}
        confirmLabel="OK"
        onConfirm={closeWaitNotice}
        onCancel={closeWaitNotice}
      />
    </>
  );
}
