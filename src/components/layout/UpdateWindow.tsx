import { useCallback, useEffect, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { UpdateDialog, type UpdatePhase } from "@/components/layout/UpdateDialog";
import { openableReleaseLink } from "@/components/layout/ReleaseNotes";
import { findUpdate, installUpdate } from "@/lib/updater";
import { tauriReleasePageFetcher, useReleaseHistory } from "@/lib/release-history";
import { logError } from "@/lib/log";
import { appVersion } from "@/lib/tauri";
import { celebrate } from "@/lib/confetti";
import { i18n, onLocaleApplied } from "@/i18n";

const RELEASES_URL = "https://github.com/Oleafly/Oleafly/releases/latest";

function releasePageFor(version: string | undefined): string {
  return version ? `https://github.com/Oleafly/Oleafly/releases/tag/v${version}` : RELEASES_URL;
}

// Runs its own update check on mount, because a separate window is a separate
// JS context and cannot share the main window's `Update` handle. `?manual=1`
// (from the menu) keeps the window open to report "up to date"; the automatic
// path closes silently when there is nothing to install.
export function UpdateWindow() {
  const manual = new URLSearchParams(window.location.search).get("manual") === "1";
  const [phase, setPhase] = useState<UpdatePhase>("checking");
  const [update, setUpdate] = useState<Update | null>(null);
  const [percent, setPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const installingRef = useRef(false);
  const [version, setVersion] = useState("");
  const celebratedRef = useRef(false);
  const checkRunRef = useRef(0);
  // Linux .deb/.rpm can't self-update (only AppImage can); when false we link
  // to the Releases page instead of an in-place "Update now" that would fail.
  const [selfInstallable, setSelfInstallable] = useState(true);

  const close = useCallback(() => void getCurrentWindow().close(), []);

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

  const runCheck = useCallback(async () => {
    const run = ++checkRunRef.current;
    const stale = () => run !== checkRunRef.current;
    setPhase("checking");
    setErrorMessage("");
    try {
      try {
        const ok = await invoke<boolean>("updater_self_installable");
        if (!stale()) setSelfInstallable(ok);
      } catch {
        // Non-Tauri/dev or command missing: assume self-installable.
      }
      const u = await findUpdate();
      if (stale()) return;
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
      if (!stale()) {
        setErrorMessage(String(e));
        setPhase("error");
      }
    }
  }, [manual]);

  useEffect(() => {
    void runCheck();
    return () => {
      checkRunRef.current++;
    };
  }, [runCheck]);

  const install = useCallback(async () => {
    if (!update || installingRef.current) return;
    installingRef.current = true;
    setPhase("downloading");
    setPercent(0);
    setErrorMessage("");
    try {
      await installUpdate(update, setPercent);
      // installUpdate relaunches the app on success; unreachable afterward.
    } catch (e) {
      await logError("updater", e);
      setErrorMessage(String(e));
      setPhase("error");
      installingRef.current = false;
    }
  }, [update]);

  const retry = useCallback(() => {
    if (update) void install();
    else void runCheck();
  }, [install, runCheck, update]);

  const openRelease = useCallback(() => {
    void openUrl(update ? releasePageFor(update.version) : RELEASES_URL);
  }, [update]);

  const openLink = useCallback((url: string) => {
    const safe = openableReleaseLink(url);
    if (safe) void openUrl(safe);
  }, []);

  const history = useReleaseHistory({
    newerThan: update?.currentVersion,
    olderThan: update?.version,
    fetchPage: tauriReleasePageFetcher,
    enabled: Boolean(update?.currentVersion && update?.version),
  });

  return (
    <UpdateDialog
      phase={phase}
      nextVersion={update?.version}
      currentVersion={update?.currentVersion}
      releaseDate={update?.date}
      notes={update?.body}
      percent={percent}
      errorMessage={errorMessage}
      selfInstallable={selfInstallable}
      installedVersion={version}
      onClose={close}
      onInstall={() => void install()}
      onRetry={retry}
      onOpenRelease={openRelease}
      onOpenLink={openLink}
      history={{
        entries: history.entries,
        status: history.status,
        onLoadMore: history.loadMore,
        onRetry: history.retry,
      }}
    />
  );
}
