import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { logError } from "@/lib/log";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { useUpdatesStore } from "@/store/updates";

const UPDATE_WINDOW_LABEL = "update";

// Talks to the update feed configured in tauri.conf.json (updates.oleafly.com,
// with GitHub Releases as the fallback endpoint), verifies the download's
// minisign signature against the embedded public key, installs, and restarts.
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
let inFlight: Promise<Update | null> | null = null;
let checking: Promise<Update | null> | null = null;

// In the browser dev server (`!isTauri()`) there is no updater, so this
// resolves to `null` just like "already up to date" - callers that need to
// tell the two apart should check `isTauri()` themselves.
export async function findUpdate(): Promise<Update | null> {
  if (!isTauri()) return null;
  checking ??= check({ timeout: 15000 }).then((update) => update ?? null).finally(() => { checking = null; });
  return checking;
}

// When the release doesn't advertise a content length, `onProgress` stays at
// 0 until the download finishes (then jumps to 100).
export async function installUpdate(
  update: Update,
  onProgress?: (percent: number) => void,
): Promise<void> {
  let total = 0;
  let downloaded = 0;
  const channel = new Channel<DownloadEvent>();
  channel.onmessage = (event) => {
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
  };
  const rid = await invoke<number>("download_update", { rid: update.rid, onEvent: channel });
  await invoke("install_update", { rid });
}

// Records the outcome in the updates store so the in-app prompt
// (`UpdateNotice`) and the About "last check failed" indicator stay in sync.
// Failures are rethrown only when `rethrow` is set, which the manual checker
// uses to render its own inline error state.
export async function runUpdateCheck({ rethrow = false }: { rethrow?: boolean } = {}): Promise<Update | null> {
  inFlight ??= (async () => {
    const store = useUpdatesStore.getState();
    try {
      const update = await findUpdate();
      if (update) store.setAvailable(update);
      else store.setUpToDate();
      return update;
    } catch (error) {
      store.setFailed();
      void logError("updater", error).catch(() => {});
      throw error;
    }
  })().finally(() => { inFlight = null; });
  try {
    return await inFlight;
  } catch (error) {
    if (rethrow) throw error;
    return null;
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
  const window = new WebviewWindow(UPDATE_WINDOW_LABEL, {
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
  void window.once("tauri://error", (event) => {
    void logError("updater", event.payload);
  });
}

export function checkForUpdatesOnStartup(): void {
  if (E2E_HOOKS) return;
  void (async () => {
    const update = await runUpdateCheck();
    if (update) await openUpdateWindow();
  })();
}
