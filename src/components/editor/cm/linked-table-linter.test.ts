// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { emitLatexLinkedTable, type LinkedLatexTable } from "@oleafly/conversion-registry/table";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { diskHash } from "@/lib/disk-hash";
import { linkedTableDiagnostics } from "./linked-table-linter";

const OLD = "Method,PSNR\nA,30.1\nB,31.4\n";
const NEW = "Method,PSNR\nA,32.0\nB,31.4\n";

function linkedTable(source = "data/results.csv"): LinkedLatexTable {
  return {
    v: 1,
    source,
    hash: diskHash(OLD),
    options: { header: true, label: "tab:results", format: "csv", highlight: { directions: [null, "higher"], best: true, second: false } },
  };
}

function documentWith(table: LinkedLatexTable): string {
  const rows = [["Method", "PSNR"], ["A", "30.1"], ["B", "31.4"]];
  return `Results.\n\n${emitLatexLinkedTable(rows, table).replace("\\begin{table}[htbp]", "\\begin{table}[t]")}\n\nMore text.\n`;
}

const views: EditorView[] = [];

function viewOf(doc: string, readOnly = false): EditorView {
  const view = new EditorView({ state: EditorState.create({ doc, extensions: EditorState.readOnly.of(readOnly) }) });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

describe("linkedTableDiagnostics", () => {
  it("points at the marker when the data changed and updates the whole table", async () => {
    const doc = documentWith(linkedTable());
    const read = vi.fn(async () => NEW);
    const [diagnostic, ...rest] = await linkedTableDiagnostics(doc, read);
    expect(rest).toEqual([]);
    expect(read).toHaveBeenCalledWith("data/results.csv");
    expect(doc.slice(diagnostic.from, diagnostic.to)).toMatch(/^% oleafly-table-v1: \S+$/);
    expect(diagnostic.severity).toBe("info");
    expect(diagnostic.message).toBe(enEditor.tableImport.dataChanged);
    expect(diagnostic.actions?.map((action) => action.name)).toEqual([enEditor.tableImport.updateTable]);

    const view = viewOf(doc);
    diagnostic.actions?.[0].apply(view, diagnostic.from, diagnostic.to);
    const updated = view.state.doc.toString();
    expect(updated).toContain("\\begin{table}[t]\n");
    expect(updated).toContain("A & \\textbf{32.0} \\\\");
    expect(updated).toContain("B & 31.4 \\\\");
    expect(updated.startsWith("Results.\n\n")).toBe(true);
    expect(updated.endsWith("\\end{table}\n\nMore text.\n")).toBe(true);
    expect(await linkedTableDiagnostics(updated, read)).toEqual([]);
  });

  it("stays quiet while the data matches or cannot be read", async () => {
    const doc = documentWith(linkedTable());
    expect(await linkedTableDiagnostics(doc, async () => OLD)).toEqual([]);
    expect(await linkedTableDiagnostics(doc, async () => null)).toEqual([]);
    expect(await linkedTableDiagnostics(doc, async () => "")).toEqual([]);
    expect(await linkedTableDiagnostics("No tables here.", async () => NEW)).toEqual([]);
  });

  it("never reads a path outside the project", async () => {
    const read = vi.fn(async () => NEW);
    expect(await linkedTableDiagnostics(documentWith(linkedTable("../secret.csv")), read)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it("leaves a read-only document unchanged", async () => {
    const doc = documentWith(linkedTable());
    const [diagnostic] = await linkedTableDiagnostics(doc, async () => NEW);
    const view = viewOf(doc, true);
    diagnostic.actions?.[0].apply(view, diagnostic.from, diagnostic.to);
    expect(view.state.doc.toString()).toBe(doc);
  });
});
