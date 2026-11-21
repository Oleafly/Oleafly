import { notationEntries, type NotationEntry } from "@oleafly/preflight/writing";
import { insertAtCursor } from "@/components/editor/cm/controller";
import { insertUsepackage, latexMainDocument } from "@/components/packages/latex-document";
import { i18n } from "@/i18n";
import { buildLatexTable } from "@/lib/latex-tools";
import { notifyError, toast } from "@/lib/toast";
import { projectTexts } from "./document-insights-load";

const LATEX_DOCUMENT = /\.(?:tex|ltx)$/iu;

function meaningCell(meaning: string): string {
  const text = meaning.replace(/^(?:the|a|an)\s+/iu, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function notationTableLatex(entries: readonly NotationEntry[], booktabs = true): string {
  const rows = entries.map((entry) => [`$${entry.symbol}$`, meaningCell(entry.meaning)]);
  const table = buildLatexTable([["Symbol", "Meaning"], ...rows], ["l", "l"], {
    booktabs,
    headerRow: true,
    caption: "Notation",
    latexCells: true,
  });
  return `${table}\n`;
}

export async function insertNotationTable(): Promise<void> {
  const mainDoc = latexMainDocument();
  if (!mainDoc) return;
  const files = Object.entries(projectTexts(LATEX_DOCUMENT)).map(([path, content]) => ({ path, content }));
  const entries = notationEntries(files, mainDoc);
  if (entries.length === 0) {
    toast.info(i18n.t(($) => $.shell.commands.notationTable.empty));
    return;
  }
  try {
    const outcome = await insertUsepackage(mainDoc, "booktabs", "");
    insertAtCursor(notationTableLatex(entries, outcome !== "no-preamble"));
  } catch (error) {
    notifyError("insert notation table", error);
  }
}
