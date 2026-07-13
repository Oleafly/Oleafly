import { useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { Markdown } from "@/components/ui/markdown";
import { findUpdate, installUpdate } from "@/lib/updater";
import { logError } from "@/lib/log";

const RELEASES_URL = "https://github.com/prajwal-svm/OpenLeaf/releases/latest";

type Phase = "checking" | "available" | "upToDate" | "downloading" | "error";

/**
 * Full-window contents of the dedicated, frameless update window (opened via
 * `?view=update`). It runs its own update check on mount, because a separate
 * window is a separate JS context and cannot share the main window's `Update`
 * handle. `?manual=1` (from the menu) keeps the window open to report "up to
 * date"; the automatic path closes silently when there is nothing to install.
 */
export function UpdateWindow() {
  const manual = new URLSearchParams(window.location.search).get("manual") === "1";
  const [phase, setPhase] = useState<Phase>("checking");
  const [update, setUpdate] = useState<Update | null>(null);
  const [percent, setPercent] = useState(0);
  // Linux .deb/.rpm installs can't self-update (only AppImage can). When false,
  // we offer a link to the Releases page instead of an in-place "Update now"
  // that would fail. Defaults true (macOS/Windows, and Linux AppImage).
  const [selfInstallable, setSelfInstallable] = useState(true);

  const close = () => void getCurrentWindow().close();

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
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manual]);

  const install = async () => {
    if (!update) return;
    setPhase("downloading");
    setPercent(0);
    try {
      await installUpdate(update, setPercent);
      // installUpdate relaunches the app on success; unreachable afterward.
    } catch (e) {
      await logError("updater", e);
      setPhase("error");
    }
  };

  const title =
    phase === "checking"
      ? "Checking for updates…"
      : phase === "upToDate"
        ? "You're up to date"
        : update
          ? `Update available · v${update.version}`
          : "OpenLeaf";

  const notes = update?.body?.trim();

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground">
      {/* Frameless, branded title bar: draggable, with our own close button. */}
      <div data-tauri-drag-region className="flex items-start gap-3 border-b px-5 py-4">
        <LeafLogo className="mt-0.5 size-7 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            OpenLeaf
          </p>
          <p className="truncate text-sm font-semibold">{title}</p>
          {update?.currentVersion && phase !== "upToDate" && (
            <p className="text-xs text-muted-foreground">You're on v{update.currentVersion}</p>
          )}
        </div>
        {phase !== "downloading" && (
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
        {phase === "checking" && (
          <p className="text-sm text-muted-foreground">Looking for the latest version…</p>
        )}
        {phase === "upToDate" && (
          <p className="text-sm text-muted-foreground">
            You're running the latest version of OpenLeaf.
          </p>
        )}
        {phase === "error" && (
          <p className="inline-flex items-center gap-1.5 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            Something went wrong. Please try again later.
          </p>
        )}
        {(phase === "available" || phase === "downloading") &&
          (notes ? (
            <Markdown className="text-sm text-muted-foreground">{notes}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">A new version is ready to install.</p>
          ))}
      </div>

      {/* Footer / actions */}
      <div className="border-t px-5 py-3">
        {phase === "downloading" ? (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              {percent >= 100 ? "Installing…" : `Downloading… ${percent}%`}
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">OpenLeaf will restart to finish.</p>
          </div>
        ) : phase === "available" && !selfInstallable ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              Installed from a package. Download the new version to update.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={close}>
                Later
              </Button>
              <Button size="sm" onClick={() => void openUrl(RELEASES_URL)}>
                View release
              </Button>
            </div>
          </div>
        ) : phase === "available" ? (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={close}>
              Later
            </Button>
            <Button size="sm" onClick={install}>
              Update now
            </Button>
          </div>
        ) : phase === "upToDate" || phase === "error" ? (
          <div className="flex items-center justify-end">
            <Button variant="secondary" size="sm" onClick={close}>
              Close
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
