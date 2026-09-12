/**
 * CSV/XLSX to LaTeX/Typst table import (G17). SheetJS parses binary
 * spreadsheets in the webview; the emitter and its escaping live in
 * @oleafly/conversion-registry so both engines share one proven path.
 */
import {
  emitLatexTable,
  emitTypstTable,
  inferAlignment,
  parseDelimited,
  type TableOptions,
} from "@oleafly/conversion-registry/table";
import { readPickedFileBase64 } from "@/lib/tauri";
import { E2E_HOOKS } from "@/lib/e2e-flags";

export type TableTarget = "latex" | "typst";

export interface TableImportOptions extends TableOptions {
  target: TableTarget;
}

function bytesFromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Parse a picked CSV/TSV/XLSX file into rows of cells. */
export async function readTableRows(path: string): Promise<string[][]> {
  const base64 = await readPickedFileBase64(path);
  const bytes = bytesFromBase64(base64);
  if (/\.(xlsx|xls)$/i.test(path)) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(bytes, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) {
      throw new Error("that spreadsheet has no sheets to import");
    }
    // Tab-separated so quoted cells survive the round trip through the
    // shared delimited parser. Merged cells read as their value in the
    // top-left cell; formulas export their cached result.
    const text = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
    return parseDelimited(text);
  }
  return parseDelimited(new TextDecoder().decode(bytes));
}

/** Emit the table source for the active engine. */
export function emitTable(rows: string[][], options: TableImportOptions): string {
  return options.target === "typst"
    ? emitTypstTable(rows, options)
    : emitLatexTable(rows, options);
}

/** Alignment the preview shows for the current options. */
export function previewAlignment(rows: string[][], hasHeader: boolean): string {
  return inferAlignment(rows, hasHeader);
}

if (E2E_HOOKS && typeof window !== "undefined") {
  const w = window as unknown as Record<string, unknown>;
  // Drives the full convert path (backend read + SheetJS + emitter) without
  // the file dialog, for the conversion-matrix e2e spec.
  w.__e2eConvertTableFile = async (
    path: string,
    options: Partial<TableImportOptions> & { target: TableTarget },
  ) => {
    const rows = await readTableRows(path);
    return emitTable(rows, {
      header: options.header ?? true,
      caption: options.caption,
      label: options.label,
      alignment: options.alignment,
      boldHeader: options.boldHeader,
      target: options.target,
    });
  };
}
