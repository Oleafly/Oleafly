import { readBalanced } from "./arguments";

export type TableAlignment = "l" | "c" | "r" | "p" | "m" | "b";

export interface TableColumn {
  align: TableAlignment;
  width: string | null;
  borderLeft: boolean;
  borderRight: boolean;
}

const SIMPLE_ALIGNMENTS = new Set<TableAlignment>(["l", "c", "r"]);
const PARAGRAPH_ALIGNMENTS = new Set<TableAlignment>(["p", "m", "b"]);

function isAlignment(value: string): value is TableAlignment {
  return SIMPLE_ALIGNMENTS.has(value as TableAlignment) || PARAGRAPH_ALIGNMENTS.has(value as TableAlignment);
}

interface SpecState {
  columns: TableColumn[];
  pendingLeft: boolean;
}

function applyBorder(state: SpecState): boolean {
  const last = state.columns.at(-1);
  if (state.pendingLeft || last?.borderRight) return false;
  if (last) last.borderRight = true;
  else state.pendingLeft = true;
  return true;
}

function readColumn(spec: string, cursor: number, state: SpecState): number | null {
  const align = spec[cursor];
  if (!isAlignment(align)) return null;
  let width: string | null = null;
  let next = cursor + 1;
  if (PARAGRAPH_ALIGNMENTS.has(align)) {
    const close = readBalanced(spec, next, "{", "}");
    if (close === null) return null;
    width = spec.slice(next + 1, close - 1);
    next = close;
  }
  state.columns.push({ align, width, borderLeft: state.pendingLeft, borderRight: false });
  state.pendingLeft = false;
  return next;
}

export function tableSpecToColumns(spec: string): TableColumn[] | null {
  const state: SpecState = { columns: [], pendingLeft: false };
  let cursor = 0;
  while (cursor < spec.length) {
    const character = spec[cursor];
    if (/\s/u.test(character)) {
      cursor++;
      continue;
    }
    if (character === "|") {
      if (!applyBorder(state)) return null;
      cursor++;
      continue;
    }
    const next = readColumn(spec, cursor, state);
    if (next === null) return null;
    cursor = next;
  }
  if (state.pendingLeft || state.columns.length === 0) return null;
  return state.columns;
}

export function columnsToTableSpec(columns: readonly TableColumn[]): string {
  return columns
    .map((column) => {
      const width = column.width === null ? "" : `{${column.width}}`;
      return `${column.borderLeft ? "|" : ""}${column.align}${width}${column.borderRight ? "|" : ""}`;
    })
    .join("");
}

export function defaultTableColumn(): TableColumn {
  return { align: "l", width: null, borderLeft: false, borderRight: false };
}

export function normalizeTableColumns(value: unknown): TableColumn[] {
  if (!Array.isArray(value)) return [];
  const columns: TableColumn[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Partial<TableColumn>;
    if (typeof candidate.align !== "string" || !isAlignment(candidate.align)) continue;
    columns.push({
      align: candidate.align,
      width: typeof candidate.width === "string" ? candidate.width : null,
      borderLeft: candidate.borderLeft === true,
      borderRight: candidate.borderRight === true,
    });
  }
  return columns;
}
