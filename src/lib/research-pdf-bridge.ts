import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Pages a research task reads from one PDF at most (the rest are noted). */
const MAX_PAGES = 300;

/**
 * Reads one PDF a research task asked about with pdf.js and sends back the
 * text of each page. A failure is reported, so the task falls back to its
 * own extractor instead of waiting.
 */
export async function answerPdfTextRequest(token: string): Promise<void> {
  try {
    const bytes = await invoke<ArrayBuffer>("research_pdf_text_fetch", { token });
    const { extractPdfText } = await import("@/lib/pdf-text");
    const { pages } = await extractPdfText(new Uint8Array(bytes), { maxPages: MAX_PAGES });
    await invoke("research_pdf_text_result", { token, pages, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await invoke("research_pdf_text_result", { token, pages: null, error: message }).catch(() => {
      // The task stopped waiting; nothing is left to answer.
    });
  }
}

/**
 * Answers the backend's PDF text requests for as long as the main window
 * lives, whichever panel is open: the app shell mounts it once at startup.
 */
export async function mountResearchPdfBridge(): Promise<() => void> {
  return listen<{ token: string }>("research-pdf-text-request", (event) => {
    void answerPdfTextRequest(event.payload.token);
  });
}
