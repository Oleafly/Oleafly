// Copying terminal text. WKWebView and WebKitGTK refuse a clipboard write
// that no click or key press started (OSC 52 from a program); a toast then
// offers a Copy button, which carries the gesture the webview needs.
import { i18n } from "@/i18n";
import { toast } from "@/lib/toast";

function writeClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return Promise.reject(new Error("clipboard unavailable"));
  }
  return navigator.clipboard.writeText(text);
}

export async function copyTerminalText(text: string): Promise<void> {
  if (!text) return;
  try {
    await writeClipboard(text);
  } catch {
    toast.infoUnique("terminal-clipboard", i18n.t(($) => $.workspace.terminal.clipboard.blocked), {
      label: i18n.t(($) => $.common.actions.copy),
      onClick: () => void writeClipboard(text).catch(() => {}),
    });
  }
}
