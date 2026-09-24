import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import { hasPandoc, downloadPandoc } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { logError } from "@/lib/log";
import { i18n } from "@/i18n";
import { formatNumber } from "@/lib/intl";
import { randomFraction } from "@/lib/random";

const INSTALL_DOCS = "https://pandoc.org/installing.html";
const PANDOC_TOAST_KEY = "pandoc-setup";
const SILENT_RETRY_BASE_MS = 60_000;
const SILENT_RETRY_MAX_MS = 30 * 60_000;

export interface EnsurePandocOptions {
  readonly notify?: boolean;
}

interface PandocDownloadProgress {
  received: number;
  total: number | null;
}

interface PandocAttempt {
  notify: boolean;
  downloading: boolean;
  label: string;
  toastId: number | null;
}

let current: { state: PandocAttempt; result: Promise<boolean> } | null = null;
let failures = 0;
let silentRetryAt = 0;

export function ensurePandoc(options: EnsurePandocOptions = {}): Promise<boolean> {
  const notify = options.notify === true;
  if (current) {
    if (notify) attachProgress(current.state);
    return current.result;
  }
  const state: PandocAttempt = {
    notify,
    downloading: false,
    label: i18n.t(($) => $.core.pandoc.downloadingPercent, { progress: 0 }),
    toastId: null,
  };
  const result = runAttempt(state);
  current = { state, result };
  return result;
}

async function runAttempt(state: PandocAttempt): Promise<boolean> {
  try {
    if (await pandocInstalled()) {
      resetBackoff();
      return true;
    }
    if (!state.notify && Date.now() < silentRetryAt) return false;
    return await download(state);
  } finally {
    if (current?.state === state) current = null;
  }
}

async function pandocInstalled(): Promise<boolean> {
  try {
    return await hasPandoc();
  } catch (error) {
    void logError("check pandoc", error);
    return false;
  }
}

async function download(state: PandocAttempt): Promise<boolean> {
  state.downloading = true;
  if (state.notify) showProgress(state);
  let unlisten: (() => void) | null = null;
  try {
    unlisten = await listen<PandocDownloadProgress>("pandoc-download-progress", (event) => {
      state.label = progressLabel(event.payload);
      if (state.toastId !== null) toast.update(state.toastId, state.label);
    });
    await downloadPandoc();
    resetBackoff();
    if (state.toastId !== null) toast.dismiss(state.toastId);
    return true;
  } catch (error) {
    void logError("download pandoc", error);
    recordFailure();
    if (state.notify) showFailure();
    return false;
  } finally {
    unlisten?.();
  }
}

function attachProgress(state: PandocAttempt): void {
  state.notify = true;
  if (state.downloading && state.toastId === null) showProgress(state);
}

function showProgress(state: PandocAttempt): void {
  state.toastId = toast.infoUnique(PANDOC_TOAST_KEY, state.label, undefined, true);
}

function showFailure(): void {
  toast.errorUnique(
    PANDOC_TOAST_KEY,
    i18n.t(($) => $.core.pandoc.downloadFailed),
    {
      label: i18n.t(($) => $.core.pandoc.installGuide),
      onClick: () => void open(INSTALL_DOCS),
    },
    true,
  );
}

function progressLabel({ received, total }: PandocDownloadProgress): string {
  if (total) {
    return i18n.t(($) => $.core.pandoc.downloadingPercent, {
      progress: Math.round((received / total) * 100),
    });
  }
  return i18n.t(($) => $.core.pandoc.downloadingSize, {
    megabytes: formatNumber(received / 1_000_000, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
  });
}

function recordFailure(): void {
  failures += 1;
  const ceiling = Math.min(SILENT_RETRY_MAX_MS, SILENT_RETRY_BASE_MS * 2 ** (failures - 1));
  silentRetryAt = Date.now() + ceiling / 2 + randomFraction() * (ceiling / 2);
}

function resetBackoff(): void {
  failures = 0;
  silentRetryAt = 0;
}
