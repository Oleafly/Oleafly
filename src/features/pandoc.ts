import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import { hasPandoc, downloadPandoc } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { logError } from "@/lib/log";
import { i18n } from "@/i18n";
import { formatNumber } from "@/lib/intl";

const INSTALL_DOCS = "https://pandoc.org/installing.html";

// Shared across concurrent callers so two quick exports don't both kick off a
// download (two progress toasts, two writes to the same binary).
let inFlight: Promise<boolean> | null = null;

export async function ensurePandoc(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = ensurePandocInner();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function ensurePandocInner(): Promise<boolean> {
  try {
    if (await hasPandoc()) return true;
  } catch {
    /* fall through and try to download */
  }

  const id = toast.info(
    i18n.t(($) => $.core.pandoc.downloadingPercent, { progress: 0 }),
    undefined,
    true,
  );
  let unlisten: (() => void) | null = null;
  try {
    unlisten = await listen<{ received: number; total: number | null }>(
      "pandoc-download-progress",
      (e) => {
        const { received, total } = e.payload;
        const label = total
          ? i18n.t(($) => $.core.pandoc.downloadingPercent, {
              progress: Math.round((received / total) * 100),
            })
          : i18n.t(($) => $.core.pandoc.downloadingSize, {
              megabytes: formatNumber(received / 1_000_000, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }),
            });
        toast.update(id, label);
      },
    );
    await downloadPandoc();
    toast.dismiss(id);
    toast.success(i18n.t(($) => $.core.pandoc.installed));
    return true;
  } catch (e) {
    toast.dismiss(id);
    void logError("download pandoc", e);
    toast.error(
      i18n.t(($) => $.core.pandoc.downloadFailed),
      {
        label: i18n.t(($) => $.core.pandoc.installGuide),
        onClick: () => void open(INSTALL_DOCS),
      },
      true,
    );
    return false;
  } finally {
    unlisten?.();
  }
}
