import type { JSONContent } from "@tiptap/core";
import { inlineToLatex } from "./serialize-inline";
import { columnsToTableSpec, defaultTableColumn, normalizeTableColumns, type TableColumn } from "./table-spec";

const INDENT = "    ";

type BlockSerializer = (node: JSONContent) => string;

interface GridCell {
  node: JSONContent;
  colspan: number;
  rowspan: number;
  rowOffset: number;
  colOffset: number;
}

function cellSpans(cell: JSONContent): { colspan: number; rowspan: number } {
  const colspan = Number(cell.attrs?.colspan ?? 1);
  const rowspan = Number(cell.attrs?.rowspan ?? 1);
  return {
    colspan: Number.isInteger(colspan) && colspan > 0 ? colspan : 1,
    rowspan: Number.isInteger(rowspan) && rowspan > 0 ? rowspan : 1,
  };
}

function tableGrid(table: JSONContent): GridCell[][] {
  const grid: GridCell[][] = [];
  const rows = (table.content ?? []).filter((row) => row.type === "tableRow");
  for (const [rowIndex, row] of rows.entries()) {
    grid[rowIndex] ??= [];
    let column = 0;
    for (const cell of row.content ?? []) {
      while (grid[rowIndex][column]) column++;
      const spans = cellSpans(cell);
      for (let offset = 0; offset < spans.rowspan; offset++) {
        grid[rowIndex + offset] ??= [];
        for (let span = 0; span < spans.colspan; span++) {
          grid[rowIndex + offset][column + span] = { node: cell, ...spans, rowOffset: offset, colOffset: span };
        }
      }
      column += spans.colspan;
    }
  }
  return grid.slice(0, rows.length);
}

function fitColumns(columns: TableColumn[], width: number): TableColumn[] {
  const fitted = columns.slice(0, width);
  while (fitted.length < width) fitted.push(defaultTableColumn());
  return fitted;
}

function cellContent(cell: JSONContent, blockToLatex: BlockSerializer): string {
  return (cell.content ?? []).map(blockToLatex).filter((text) => text.length > 0).join(" ");
}

function cellToLatex(slot: GridCell, columns: TableColumn[], index: number, blockToLatex: BlockSerializer): string {
  let content = cellContent(slot.node, blockToLatex);
  if (slot.rowspan > 1) content = String.raw`\multirow{${slot.rowspan}}{*}{${content}}`;
  const columnSpec = slot.node.attrs?.columnSpec;
  if (slot.colspan === 1 && typeof columnSpec !== "string") return content;
  const spec = typeof columnSpec === "string" ? columnSpec : columnsToTableSpec(columns.slice(index, index + slot.colspan));
  return String.raw`\multicolumn{${slot.colspan}}{${spec}}{${content}}`;
}

function rowCells(row: GridCell[], columns: TableColumn[], blockToLatex: BlockSerializer): string {
  const cells: string[] = [];
  for (let index = 0; index < columns.length; index++) {
    const slot = row[index];
    if (!slot) {
      cells.push("");
      continue;
    }
    if (slot.rowOffset > 0) {
      cells.push("");
      continue;
    }
    if (slot.colOffset > 0) continue;
    cells.push(cellToLatex(slot, columns, index, blockToLatex));
  }
  return cells.join(" & ");
}

function ruleLines(value: unknown): string[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  return value
    .trim()
    .split(/\s+/u)
    .map((rule) => `\\${rule}`);
}

export function tabularLines(table: JSONContent, columns: TableColumn[], blockToLatex: BlockSerializer): string[] {
  const grid = tableGrid(table);
  const width = grid.length ? Math.max(1, ...grid.map((row) => row.length)) : columns.length;
  const fitted = fitColumns(columns, width);
  const rows = (table.content ?? []).filter((row) => row.type === "tableRow");
  const lines = [String.raw`\begin{tabular}{${columnsToTableSpec(fitted)}}`];
  for (const [index, row] of rows.entries()) {
    lines.push(
      ...ruleLines(row.attrs?.borderTop).map((rule) => `${INDENT}${rule}`),
      String.raw`${INDENT}${rowCells(grid[index] ?? [], fitted, blockToLatex)} \\`,
      ...ruleLines(row.attrs?.borderBottom).map((rule) => `${INDENT}${rule}`),
    );
  }
  lines.push(String.raw`\end{tabular}`);
  return lines;
}

export function bareTableToLatex(table: JSONContent, blockToLatex: BlockSerializer): string {
  return tabularLines(table, [], blockToLatex).join("\n");
}

export function tableFloatToLatex(node: JSONContent, blockToLatex: BlockSerializer): string {
  const attrs = node.attrs ?? {};
  const table = node.content?.find((child) => child.type === "table") ?? { type: "table", content: [] };
  const caption = node.content?.find((child) => child.type === "tableCaption");
  const tabular = tabularLines(table, normalizeTableColumns(attrs.columns), blockToLatex);
  if (attrs.floating === false && !caption && !attrs.label) return tabular.join("\n");
  const captionLine = caption ? String.raw`${INDENT}\caption{${inlineToLatex(caption.content)}}` : null;
  const placement = typeof attrs.placement === "string" && attrs.placement !== "" ? `[${attrs.placement}]` : "";
  const lines = [String.raw`\begin{table}${placement}`];
  if (attrs.centering === true) lines.push(String.raw`${INDENT}\centering`);
  if (captionLine && attrs.captionPosition === "above") lines.push(captionLine);
  lines.push(...tabular.map((line) => `${INDENT}${line}`));
  if (captionLine && attrs.captionPosition !== "above") lines.push(captionLine);
  if (typeof attrs.label === "string" && attrs.label !== "") lines.push(String.raw`${INDENT}\label{${attrs.label}}`);
  lines.push(String.raw`\end{table}`);
  return lines.join("\n");
}
