import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import { hasPandoc, downloadPandoc } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { logError } from "@/lib/log";

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

  const id = toast.info("Downloading pandoc… 0%", undefined, true);
  let unlisten: (() => void) | null = null;
  try {
    unlisten = await listen<{ received: number; total: number | null }>(
      "pandoc-download-progress",
      (e) => {
        const { received, total } = e.payload;
        const label = total
          ? `Downloading pandoc… ${Math.round((received / total) * 100)}%`
          : `Downloading pandoc… ${(received / 1_000_000).toFixed(1)} MB`;
        toast.update(id, label);
      },
    );
    await downloadPandoc();
    toast.dismiss(id);
    toast.success("pandoc installed");
    return true;
  } catch (e) {
    toast.dismiss(id);
    void logError("download pandoc", e);
    toast.error(
      "Couldn't download pandoc. Install it manually, then try again",
      { label: "Install guide", onClick: () => void open(INSTALL_DOCS) },
      true,
    );
    return false;
  } finally {
    unlisten?.();
  }
}
