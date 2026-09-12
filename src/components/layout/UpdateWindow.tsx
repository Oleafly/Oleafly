import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Update } from "@tauri-apps/plugin-updater";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { Markdown } from "@/components/ui/markdown";
import { findUpdate, installUpdate } from "@/lib/updater";
import { Progress } from "@/components/ui/progress";
import { logError } from "@/lib/log";
import { appVersion } from "@/lib/tauri";
import { celebrate } from "@/lib/confetti";
import { i18n, onLocaleApplied } from "@/i18n";

const RELEASES_URL = "https://github.com/Oleafly/Oleafly/releases/latest";

type Phase = "checking" | "available" | "upToDate" | "downloading" | "error";

// Runs its own update check on mount, because a separate window is a separate
// JS context and cannot share the main window's `Update` handle. `?manual=1`
// (from the menu) keeps the window open to report "up to date"; the automatic
// path closes silently when there is nothing to install.
export function UpdateWindow() {
  const { t } = useTranslation(["common", "shell"]);
  const manual = new URLSearchParams(window.location.search).get("manual") === "1";
  const [phase, setPhase] = useState<Phase>("checking");
  const [update, setUpdate] = useState<Update | null>(null);
  const [percent, setPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const installingRef = useRef(false);
  const [version, setVersion] = useState("");
  const celebratedRef = useRef(false);
  // Linux .deb/.rpm can't self-update (only AppImage can); when false we link
  // to the Releases page instead of an in-place "Update now" that would fail.
  const [selfInstallable, setSelfInstallable] = useState(true);

  const close = () => void getCurrentWindow().close();

  useEffect(() => {
    void appVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const applyTitle = () => {
      void getCurrentWindow()
        .setTitle(i18n.t(($) => $.shell.windows.update))
        .catch(() => {});
    };
    applyTitle();
    return onLocaleApplied(applyTitle);
  }, []);

  useEffect(() => {
    if (phase !== "upToDate" || celebratedRef.current) return;
    celebratedRef.current = true;
    celebrate();
  }, [phase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        try {
          const ok = await invoke<boolean>("updater_self_installable");
          if (!cancelled) setSelfInstallable(ok);
        } catch {
          // Non-Tauri/dev or command missing: assume self-installable.
        }
        const u = await findUpdate();
        if (cancelled) return;
        if (u) {
          setUpdate(u);
          setPhase("available");
        } else if (manual) {
          setPhase("upToDate");
        } else {
          // Auto-check with nothing to offer: this window shouldn't linger.
          void getCurrentWindow().close();
        }
      } catch (e) {
        await logError("updater", e);
        if (!cancelled) { setErrorMessage(String(e)); setPhase("error"); }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manual]);

  const install = async () => {
    if (!update || installingRef.current) return;
    installingRef.current = true;
    setPhase("downloading");
    setPercent(0);
    try {
      await installUpdate(update, setPercent);
      // installUpdate relaunches the app on success; unreachable afterward.
    } catch (e) {
      await logError("updater", e);
      setErrorMessage(String(e));
      setPhase("error");
      installingRef.current = false;
    }
  };

  const windowTitle = () => {
    if (phase === "checking") {
      return t(($) => $.shell.updateWindow.checking);
    }
    if (phase === "upToDate") {
      return t(($) => $.shell.updateWindow.upToDate);
    }
    if (update) {
      return t(($) => $.shell.updateChecker.available, { version: update.version });
    }
    return "Oleafly";
  };
  const title = windowTitle();

  const notes = update?.body?.trim();

  const renderFooter = () => {
    if (phase === "downloading") {
      return (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {percent >= 100
              ? t(($) => $.shell.updateChecker.installing)
              : t(($) => $.shell.updateChecker.downloading, { percent })}
          </p>
          <Progress value={percent} />
          <p className="text-[10px] text-muted-foreground">
            {t(($) => $.shell.updateChecker.restartNotice)}
          </p>
        </div>
      );
    }
    if (phase === "available" && !selfInstallable) {
      return (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {t(($) => $.shell.updateWindow.packageInstall)}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={close}>
              {t(($) => $.shell.updateWindow.later)}
            </Button>
            <Button size="sm" onClick={() => void openUrl(RELEASES_URL)}>
              {t(($) => $.shell.updateWindow.viewRelease)}
            </Button>
          </div>
        </div>
      );
    }
    if (phase === "available") {
      return (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={close}>
            {t(($) => $.shell.updateWindow.later)}
          </Button>
          <Button size="sm" onClick={install}>
            {t(($) => $.shell.updateChecker.updateNow)}
          </Button>
        </div>
      );
    }
    if (phase === "upToDate" || phase === "error") {
      return (
        <div className="flex items-center justify-end gap-2">
          {phase === "error" && (
            <Button size="sm" onClick={() => void openUrl(RELEASES_URL)}>
              {t(($) => $.shell.updateWindow.viewRelease)}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={close}>
            {t(($) => $.common.actions.close)}
          </Button>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground">
      {/* Frameless window: draggable region substitutes for the native title bar. */}
      <div data-tauri-drag-region className="flex items-start gap-3 border-b px-5 py-4">
        <LeafLogo className="mt-0.5 size-7 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {"Oleafly"}
          </p>
          <p className="truncate text-sm font-semibold">{title}</p>
          {update?.currentVersion && phase !== "upToDate" && (
            <p className="text-xs text-muted-foreground">
              {t(($) => $.shell.updateWindow.currentVersion, { version: update.currentVersion })}
            </p>
          )}
        </div>
        {phase !== "downloading" && (
          <button
            type="button"
            onClick={close}
            aria-label={t(($) => $.common.actions.close)}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
        {phase === "checking" && (
          <p className="text-sm text-muted-foreground">
            {t(($) => $.shell.updateWindow.looking)}
          </p>
        )}
        {phase === "upToDate" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex size-20 items-center justify-center text-emerald-500">
              <CheckCircle2 className="size-14" strokeWidth={1.6} />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold text-foreground">
                {t(($) => $.shell.updateWindow.upToDateHeadline)}
              </p>
              <p className="text-sm text-muted-foreground">
                {version
                  ? t(($) => $.shell.updateWindow.upToDateVersion, { version })
                  : t(($) => $.shell.updateWindow.upToDateGeneric)}
              </p>
            </div>
          </div>
        )}
        {phase === "error" && (
          <p className="inline-flex items-center gap-1.5 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {errorMessage || t(($) => $.shell.updateWindow.error)}
          </p>
        )}
        {(phase === "available" || phase === "downloading") &&
          (notes ? (
            <Markdown className="text-sm text-muted-foreground">{notes}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t(($) => $.shell.updateWindow.ready)}
            </p>
          ))}
      </div>

      <div className="border-t px-5 py-3">
        {renderFooter()}
      </div>
    </div>
  );
}
