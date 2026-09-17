import type { ColumnSpec } from "./column-spec";
import type { TextRange } from "./syntax";

export interface MultiColumnData {
  span: number;
  columns: ColumnSpec[];
  spec: TextRange;
  from: number;
  to: number;
  preamble: TextRange;
  postamble: TextRange;
}

export interface CellData {
  content: string;
  from: number;
  to: number;
  multiColumn?: MultiColumnData;
}

export interface RowData {
  cells: CellData[];
  rulesAbove: string[];
  rulesBelow: string[];
}

export interface RowLayout {
  range: TextRange;
  rulesAbove: TextRange[];
  rulesBelow: TextRange[];
}

export interface ParsedTable {
  model: TableModel;
  tabular: TextRange;
  spec: TextRange;
  body: TextRange;
  rows: RowLayout[];
  rowSeparators: TextRange[];
  cellSeparators: TextRange[][];
}

export interface TableEnvironmentInfo {
  range: TextRange;
  caption?: TextRange;
  label?: TextRange;
}

export type BorderPreset = "none" | "all" | "booktabs";

const HLINE = String.raw`\hline`;

function mergedBordersMatch(cell: CellData, bordered: boolean): boolean {
  const spec = cell.multiColumn?.columns[0];
  if (!spec) return false;
  const left = spec.borderLeft > 0;
  const right = spec.borderRight > 0;
  return bordered ? left && right : !left && !right;
}

export function cellSpan(cell: CellData): number {
  return cell.multiColumn?.span ?? 1;
}

export class TableModel {
  constructor(
    readonly rows: RowData[],
    readonly columns: ColumnSpec[],
  ) {}

  get rowCount(): number {
    return this.rows.length;
  }

  get columnCount(): number {
    return this.columns.length;
  }

  cellIndexAt(row: number, column: number): number {
    const cells = this.rows[row].cells;
    let reached = 0;
    for (let index = 0; index < cells.length; index++) {
      reached += cellSpan(cells[index]);
      if (column < reached) return index;
    }
    return cells.length - 1;
  }

  cellAt(row: number, column: number): CellData {
    return this.rows[row].cells[this.cellIndexAt(row, column)];
  }

  columnStartOf(row: number, cellIndex: number): number {
    let start = 0;
    for (let index = 0; index < cellIndex; index++) start += cellSpan(this.rows[row].cells[index]);
    return start;
  }

  cellBounds(row: number, column: number): { from: number; to: number } {
    const cells = this.rows[row].cells;
    let start = 0;
    for (const cell of cells) {
      const span = cellSpan(cell);
      if (start + span > column) return { from: start, to: start + span - 1 };
      start += span;
    }
    throw new Error("Column index outside the row");
  }

  forEachCell(
    minRow: number,
    maxRow: number,
    minColumn: number,
    maxColumn: number,
    callback: (cell: CellData, row: number, column: number) => void,
  ): void {
    for (let row = minRow; row <= maxRow; row++) {
      const first = this.cellIndexAt(row, minColumn);
      const last = this.cellIndexAt(row, maxColumn);
      let column = this.cellBounds(row, minColumn).from;
      for (let index = first; index <= last; index++) {
        const cell = this.rows[row].cells[index];
        callback(cell, row, column);
        column += cellSpan(cell);
      }
    }
  }

  hasVerticalBorders(): boolean {
    return this.columns.some((column) => column.borderLeft > 0 || column.borderRight > 0);
  }

  borderPreset(): BorderPreset | null {
    const last = this.rows.at(-1);
    if (!last || this.columns.length === 0) return null;
    if (this.isBooktabs()) return "booktabs";
    const rowsAll =
      this.rows.every((row) => row.rulesAbove.join() === HLINE) && last.rulesBelow.join() === HLINE;
    const rowsNone = this.rows.every((row) => row.rulesAbove.length === 0) && last.rulesBelow.length === 0;
    if (rowsAll && this.everyColumnEdgeBordered() && this.multiColumnsMatch(true)) return "all";
    if (rowsNone && !this.hasVerticalBorders() && this.multiColumnsMatch(false)) return "none";
    return null;
  }

  private isBooktabs(): boolean {
    const last = this.rows.at(-1);
    if (!last) return false;
    const top = this.rows[0].rulesAbove.join() === String.raw`\toprule`;
    const mid = this.rows.length < 2 || this.rows[1].rulesAbove.join() === String.raw`\midrule`;
    const bottom = last.rulesBelow.join() === String.raw`\bottomrule`;
    const others = this.rows.slice(2).some((row) => row.rulesAbove.length > 0);
    return top && mid && bottom && !others && !this.hasVerticalBorders() && this.multiColumnsMatch(false);
  }

  private everyColumnEdgeBordered(): boolean {
    const columns = this.columns;
    const last = columns.at(-1);
    if (!last || columns[0].borderLeft === 0 || last.borderRight === 0) return false;
    for (let index = 0; index < columns.length - 1; index++) {
      if (columns[index].borderRight === 0 && columns[index + 1].borderLeft === 0) return false;
    }
    return true;
  }

  private multiColumnsMatch(bordered: boolean): boolean {
    for (const row of this.rows) {
      for (const cell of row.cells) {
        if (!cell.multiColumn) continue;
        if (!mergedBordersMatch(cell, bordered)) return false;
      }
    }
    return true;
  }
}
