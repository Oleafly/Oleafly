import type { SynctexForwardHit, SynctexRect } from "@oleafly/backend-port";
import type { SyncTexIndex } from "@oleafly/compile-port";
import { findWordOnPages, getCurrentLine, pickForwardLine, type SourceWord, wordAtCursor } from "@oleafly/editor";
import { gotoRect, type PdfTextRun, pdfPageText } from "@oleafly/preview/controller";

export interface SyncView {
  cursor(): { line: number; word: SourceWord | null } | null;
  pageText(page: number): Promise<readonly PdfTextRun[] | null>;
  show(rect: SynctexRect): void;
}

export const pageView: SyncView = {
  cursor() {
    const line = getCurrentLine();
    return line === null ? null : { line, word: wordAtCursor() };
  },
  pageText: (page) => pdfPageText(page),
  show: (rect) => gotoRect(rect),
};

async function lineWithWord(hit: SynctexForwardHit, word: SourceWord | null, view: SyncView): Promise<SynctexRect> {
  if (!word) return hit;
  const lines = hit.lines ?? [];
  const pages = lines.length > 0 ? [...new Set(lines.map((line) => line.page))] : [hit.page];
  const runs = new Map<number, readonly PdfTextRun[]>();
  for (const page of pages) {
    const text = await view.pageText(page);
    if (text) runs.set(page, text);
  }
  const found = lines.length > 0 ? pickForwardLine(lines, runs, word) : findWordOnPages(pages, runs, word);
  return found ?? hit;
}

export async function forwardSync(
  index: SyncTexIndex,
  path: string,
  view: SyncView = pageView,
  compiledLine: (line: number) => Promise<number | null> = async (line) => line,
): Promise<boolean> {
  const cursor = view.cursor();
  if (!cursor) return false;
  const line = await compiledLine(cursor.line);
  if (line === null) return false;
  const hit = await index.forward(path, line);
  if (!hit) return false;
  view.show(await lineWithWord(hit, cursor.word, view));
  return true;
}
