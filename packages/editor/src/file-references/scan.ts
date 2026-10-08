import { scanLatexReferences } from "./scan-latex";
import { scanMarkdownReferences } from "./scan-markdown";
import { scanTypstReferences } from "./scan-typst";
import type { FileReferenceLanguage, PathReference } from "./types";

export function referenceLanguageForPath(path: string): FileReferenceLanguage | null {
  if (/\.(?:tex|ltx|latex|sty|cls)$/i.test(path)) return "latex";
  if (/\.typ$/i.test(path)) return "typst";
  if (/\.(?:md|markdown)$/i.test(path)) return "markdown";
  return null;
}

export function scanPathReferences(language: FileReferenceLanguage, text: string): PathReference[] {
  if (language === "latex") return scanLatexReferences(text);
  if (language === "typst") return scanTypstReferences(text);
  return scanMarkdownReferences(text);
}

function covers(span: { from: number; to: number }, offset: number): boolean {
  return offset >= span.from && offset <= span.to;
}

export function pathReferenceAt(
  language: FileReferenceLanguage,
  text: string,
  offset: number,
): PathReference | null {
  return (
    scanPathReferences(language, text).find(
      (reference) => covers(reference, offset) || (reference.directory !== undefined && covers(reference.directory, offset)),
    ) ?? null
  );
}
