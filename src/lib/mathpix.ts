// Bridge to the Mathpix commands. The keys and every Mathpix request stay in
// Rust (src-tauri/src/mathpix.rs): this module can save or clear the keys and
// ask whether they exist, but never reads the key back.
import { Channel, invoke } from "@tauri-apps/api/core";

export interface MathpixKeyStatus {
  configured: boolean;
  appId: string | null;
}

export interface MathpixTextResult {
  text: string;
  /** Only when the whole image is one equation. */
  latexStyled: string | null;
  confidence: number | null;
}

export interface MathpixPdfProgress {
  status: string;
  pagesDone: number;
  pagesTotal: number;
}

const PAGE_RANGES_HEADER = "x-oleafly-page-ranges";
const REQUEST_ID_HEADER = "x-oleafly-request-id";

export const mathpixKeyStatus = () => invoke<MathpixKeyStatus>("mathpix_key_status");

export const mathpixSaveKeys = (appId: string, appKey: string) =>
  invoke<MathpixKeyStatus>("mathpix_save_keys", { appId, appKey });

export const mathpixClearKeys = () => invoke<void>("mathpix_clear_keys");

/** Reads one PNG or JPEG image (base64, no data URL prefix). */
export const mathpixText = (imageBase64: string, mime: string) =>
  invoke<MathpixTextResult>("mathpix_text", { imageBase64, mime });

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

/**
 * Converts a PDF with Mathpix and returns its Mathpix Markdown. The whole
 * file is uploaded; `pageRanges` (such as "3-5") limits what Mathpix converts
 * and bills. Cancelling through `signal` stops the upload itself when it is
 * still running; Rust deletes the PDF from Mathpix when the conversion
 * finishes, fails, times out or is cancelled.
 */
export async function mathpixPdf(
  bytes: Uint8Array,
  options: {
    pageRanges: string;
    onProgress?: (progress: MathpixPdfProgress) => void;
    signal?: AbortSignal;
  },
): Promise<string> {
  const { signal } = options;
  if (signal?.aborted) throw abortError();
  const requestId = crypto.randomUUID();
  // One cancel call, whenever it comes: during the upload, between it and
  // the wait, or during the wait.
  let cancelling: Promise<void> | null = null;
  const cancel = () => {
    cancelling ??= invoke<void>("mathpix_pdf_cancel", { requestId }).catch(() => undefined);
    return cancelling;
  };
  const stop = () => {
    void cancel();
  };
  signal?.addEventListener("abort", stop, { once: true });
  const channel = new Channel<MathpixPdfProgress>();
  channel.onmessage = (progress) => options.onProgress?.(progress);
  try {
    const pdfId = await invoke<string>("mathpix_pdf_upload", bytes, {
      headers: { [PAGE_RANGES_HEADER]: options.pageRanges, [REQUEST_ID_HEADER]: requestId },
    });
    // Stopped as the upload finished: the cancel goes first, so the wait
    // below only deletes the uploaded PDF from Mathpix.
    if (signal?.aborted) await cancel();
    const markdown = await invoke<string>("mathpix_pdf_wait", {
      requestId,
      pdfId,
      onProgress: channel,
    });
    if (signal?.aborted) throw abortError();
    return markdown;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", stop);
    channel.onmessage = () => {};
  }
}
