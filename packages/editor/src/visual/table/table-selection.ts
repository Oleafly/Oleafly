import type { TableModel } from "./model";

export interface CellCoordinate {
  readonly row: number;
  readonly column: number;
}

export interface SelectionBounds {
  minRow: number;
  maxRow: number;
  minColumn: number;
  maxColumn: number;
}

export class CellSelection {
  readonly anchor: CellCoordinate;
  readonly head: CellCoordinate;

  constructor(anchor: CellCoordinate, head: CellCoordinate = anchor) {
    this.anchor = anchor;
    this.head = head;
  }

  static cell(row: number, column: number): CellSelection {
    return new CellSelection({ row, column });
  }

  static row(model: TableModel, row: number): CellSelection {
    return new CellSelection({ row, column: 0 }, { row, column: model.columnCount - 1 });
  }

  static column(model: TableModel, column: number): CellSelection {
    return new CellSelection({ row: 0, column }, { row: model.rowCount - 1, column });
  }

  get bounds(): SelectionBounds {
    return {
      minRow: Math.min(this.anchor.row, this.head.row),
      maxRow: Math.max(this.anchor.row, this.head.row),
      minColumn: Math.min(this.anchor.column, this.head.column),
      maxColumn: Math.max(this.anchor.column, this.head.column),
    };
  }

  eq(other: CellSelection): boolean {
    return (
      this.anchor.row === other.anchor.row &&
      this.anchor.column === other.anchor.column &&
      this.head.row === other.head.row &&
      this.head.column === other.head.column
    );
  }

  width(): number {
    const { minColumn, maxColumn } = this.bounds;
    return maxColumn - minColumn + 1;
  }

  height(): number {
    const { minRow, maxRow } = this.bounds;
    return maxRow - minRow + 1;
  }

  contains(model: TableModel, row: number, column: number): boolean {
    const { minRow, maxRow, minColumn, maxColumn } = this.bounds;
    if (row < minRow || row > maxRow) return false;
    const { from, to } = model.cellBounds(row, column);
    return from >= minColumn && to <= maxColumn;
  }

  isRowSelected(model: TableModel, row: number): boolean {
    const { minRow, maxRow, minColumn, maxColumn } = this.bounds;
    return row >= minRow && row <= maxRow && minColumn === 0 && maxColumn === model.columnCount - 1;
  }

  isColumnSelected(model: TableModel, column: number): boolean {
    const { minRow, maxRow, minColumn, maxColumn } = this.bounds;
    return column >= minColumn && column <= maxColumn && minRow === 0 && maxRow === model.rowCount - 1;
  }

  anyRowSelected(model: TableModel): boolean {
    const { minRow } = this.bounds;
    return this.isRowSelected(model, minRow);
  }

  anyColumnSelected(model: TableModel): boolean {
    const { minColumn } = this.bounds;
    return this.isColumnSelected(model, minColumn);
  }

  coversTable(model: TableModel): boolean {
    const { minRow, maxRow, minColumn, maxColumn } = this.bounds;
    return minRow === 0 && minColumn === 0 && maxRow === model.rowCount - 1 && maxColumn === model.columnCount - 1;
  }

  selectRow(model: TableModel, row: number, extend: boolean): CellSelection {
    return new CellSelection(
      { row: extend ? this.anchor.row : row, column: 0 },
      { row, column: model.columnCount - 1 },
    );
  }

  selectColumn(model: TableModel, column: number, extend: boolean): CellSelection {
    return new CellSelection(
      { row: 0, column: extend ? this.anchor.column : column },
      { row: model.rowCount - 1, column },
    );
  }

  expand(model: TableModel): CellSelection {
    let current: CellSelection = this;
    for (let guard = 0; guard < model.columnCount + 1; guard++) {
      const grown = current.expandOnce(model);
      if (grown.eq(current)) return current;
      current = grown;
    }
    return current;
  }

  private expandOnce(model: TableModel): CellSelection {
    const { minRow, maxRow, minColumn, maxColumn } = this.bounds;
    for (let row = minRow; row <= maxRow; row++) {
      const left = model.cellBounds(row, minColumn);
      const right = model.cellBounds(row, maxColumn);
      if (left.from < minColumn) return this.withColumnEdge(minColumn, left.from);
      if (right.to > maxColumn) return this.withColumnEdge(maxColumn, right.to);
    }
    return this;
  }

  private withColumnEdge(edge: number, replacement: number): CellSelection {
    if (this.anchor.column === edge) {
      return new CellSelection({ row: this.anchor.row, column: replacement }, this.head);
    }
    return new CellSelection(this.anchor, { row: this.head.row, column: replacement });
  }

  moveLeft(model: TableModel): CellSelection {
    const { from } = model.cellBounds(this.head.row, this.head.column);
    return CellSelection.cell(this.head.row, Math.max(0, from - 1)).expand(model);
  }

  moveRight(model: TableModel): CellSelection {
    const { to } = model.cellBounds(this.head.row, this.head.column);
    return CellSelection.cell(this.head.row, Math.min(model.columnCount - 1, to + 1)).expand(model);
  }

  moveUp(model: TableModel): CellSelection {
    return CellSelection.cell(Math.max(0, this.head.row - 1), this.head.column).expand(model);
  }

  moveDown(model: TableModel): CellSelection {
    const { from } = model.cellBounds(this.head.row, this.head.column);
    return CellSelection.cell(Math.min(model.rowCount - 1, this.head.row + 1), from).expand(model);
  }

  next(model: TableModel): CellSelection | null {
    const { row, column } = this.head;
    const { to } = model.cellBounds(row, column);
    if (to < model.columnCount - 1) return CellSelection.cell(row, to + 1).expand(model);
    if (row < model.rowCount - 1) return CellSelection.cell(row + 1, 0).expand(model);
    return null;
  }

  previous(model: TableModel): CellSelection {
    const { row, column } = this.head;
    const { from } = model.cellBounds(row, column);
    if (from > 0) return CellSelection.cell(row, from - 1).expand(model);
    if (row > 0) return CellSelection.cell(row - 1, model.columnCount - 1).expand(model);
    return CellSelection.cell(row, column).expand(model);
  }

  extendLeft(model: TableModel): CellSelection {
    const { minRow, maxRow } = this.bounds;
    let column = this.head.column;
    for (let row = minRow; row <= maxRow; row++) {
      column = Math.min(column, model.cellBounds(row, this.head.column).from - 1);
    }
    return new CellSelection(this.anchor, { row: this.head.row, column: Math.max(0, column) }).expand(model);
  }

  extendRight(model: TableModel): CellSelection {
    const { minRow, maxRow } = this.bounds;
    let column = this.head.column;
    for (let row = minRow; row <= maxRow; row++) {
      column = Math.max(column, model.cellBounds(row, this.head.column).to + 1);
    }
    return new CellSelection(this.anchor, {
      row: this.head.row,
      column: Math.min(model.columnCount - 1, column),
    }).expand(model);
  }

  extendUp(model: TableModel): CellSelection {
    return new CellSelection(this.anchor, { row: Math.max(0, this.head.row - 1), column: this.head.column }).expand(
      model,
    );
  }

  extendDown(model: TableModel): CellSelection {
    return new CellSelection(this.anchor, {
      row: Math.min(model.rowCount - 1, this.head.row + 1),
      column: this.head.column,
    }).expand(model);
  }

  isMergedCell(model: TableModel): boolean {
    if (this.anchor.row !== this.head.row) return false;
    const first = model.cellBounds(this.anchor.row, this.anchor.column);
    const last = model.cellBounds(this.head.row, this.head.column);
    if (first.from !== last.from) return false;
    return Boolean(model.cellAt(this.anchor.row, first.from).multiColumn);
  }

  canMerge(model: TableModel): boolean {
    const { minRow, maxRow, minColumn, maxColumn } = this.bounds;
    if (minRow !== maxRow || minColumn === maxColumn) return false;
    for (let column = minColumn; column <= maxColumn; column++) {
      if (model.cellAt(minRow, column).multiColumn) return false;
    }
    return true;
  }

  onlyParagraphColumns(model: TableModel): boolean {
    const { minColumn, maxColumn } = this.bounds;
    for (let column = minColumn; column <= maxColumn; column++) {
      if (!this.isColumnSelected(model, column) || !model.columns[column].paragraph) return false;
    }
    return true;
  }

  onlyPlainColumns(model: TableModel): boolean {
    const { minColumn, maxColumn } = this.bounds;
    for (let column = minColumn; column <= maxColumn; column++) {
      if (!this.isColumnSelected(model, column) || model.columns[column].paragraph) return false;
    }
    return true;
  }

  widestRowSpan(model: TableModel): number {
    const { minRow, maxRow, minColumn, maxColumn } = this.bounds;
    let widest = 1;
    for (let row = minRow; row <= maxRow; row++) {
      widest = Math.max(widest, model.cellIndexAt(row, maxColumn) - model.cellIndexAt(row, minColumn) + 1);
    }
    return widest;
  }
}

export function clampSelection(model: TableModel, selection: CellSelection | null): CellSelection | null {
  if (!selection || model.rowCount === 0 || model.columnCount === 0) return null;
  const clamp = (point: CellCoordinate): CellCoordinate => ({
    row: Math.max(0, Math.min(model.rowCount - 1, point.row)),
    column: Math.max(0, Math.min(model.columnCount - 1, point.column)),
  });
  const clamped = new CellSelection(clamp(selection.anchor), clamp(selection.head));
  return clamped.expand(model);
}
