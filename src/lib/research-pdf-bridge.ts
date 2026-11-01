import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const MAX_PAGES = 300;

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

export function mountResearchPdfBridge(): Promise<() => void> {
  return listen<{ token: string }>("research-pdf-text-request", (event) => {
    void answerPdfTextRequest(event.payload.token);
  });
}
