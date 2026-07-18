import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { logError } from "@/lib/log";
import { useUpdatesStore } from "@/store/updates";

const UPDATE_WINDOW_LABEL = "update";

// Talks to the GitHub Releases `latest.json` (configured in tauri.conf.json),
// verifies the download's minisign signature against the embedded public
// key, installs, and restarts.
//
// The prompt is fully in-app: the startup check records its result in the
// updates store (for the About indicator) and, when an update exists, opens
// a dedicated frameless window (`UpdateWindow`) rather than a native OS
// dialog.
//
// The updater only exists in a bundled desktop app; in the browser dev
// server (`isTauri()` is false) every entry point is a no-op so nothing
// throws.

// Guard against overlapping checks (startup tick racing a manual click).
let inFlight = false;

// In the browser dev server (`!isTauri()`) there is no updater, so this
// resolves to `null` just like "already up to date" - callers that need to
// tell the two apart should check `isTauri()` themselves.
export async function findUpdate(): Promise<Update | null> {
  if (!isTauri()) return null;
  // Bound the check so a hung request can't latch `inFlight` forever (see
  // runUpdateCheck). The updater plugin's check() accepts a `timeout` in ms.
  const update = await check({ timeout: 15000 });
  return update ?? null;
}

// When the release doesn't advertise a content length, `onProgress` stays at
// 0 until the download finishes (then jumps to 100).
export async function installUpdate(
  update: Update,
  onProgress?: (percent: number) => void,
): Promise<void> {
  let total = 0;
  let downloaded = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        onProgress?.(0);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        if (total > 0) onProgress?.(Math.min(100, Math.round((downloaded / total) * 100)));
        break;
      case "Finished":
        onProgress?.(100);
        break;
    }
  });
  await relaunch();
}

// Records the outcome in the updates store so the in-app prompt
// (`UpdateNotice`) and the About "last check failed" indicator stay in sync.
// Failures are rethrown only when `rethrow` is set, which the manual checker
// uses to render its own inline error state.
export async function runUpdateCheck({ rethrow = false }: { rethrow?: boolean } = {}): Promise<Update | null> {
  if (inFlight) return null;
  inFlight = true;
  const store = useUpdatesStore.getState();
  try {
    const update = await findUpdate();
    if (update) store.setAvailable(update);
    else store.setUpToDate();
    return update;
  } catch (e) {
    await logError("updater", e);
    store.setFailed();
    if (rethrow) throw e;
    return null;
  } finally {
    inFlight = false;
  }
}

// `manual` keeps the window open to report "up to date" (menu-triggered);
// the automatic path lets the window close itself when there's nothing to
// install.
export async function openUpdateWindow(opts: { manual?: boolean } = {}): Promise<void> {
  if (!isTauri()) return;
  const existing = await WebviewWindow.getByLabel(UPDATE_WINDOW_LABEL);
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow(UPDATE_WINDOW_LABEL, {
    url: `index.html?view=update${opts.manual ? "&manual=1" : ""}`,
    title: "Oleafly Update",
    width: 600,
    height: 520,
    resizable: false,
    center: true,
    decorations: false,
    // Transparent so the webview's rounded card defines the window shape
    // (macOS draws its shadow around the opaque rounded content).
    transparent: true,
    focus: true,
  });
}

export function checkForUpdatesOnStartup(): void {
  void (async () => {
    const update = await runUpdateCheck();
    if (update) await openUpdateWindow();
  })();
}
