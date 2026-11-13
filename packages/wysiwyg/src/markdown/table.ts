import { getHTMLFromFragment } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { isInTable, selectedRect } from "@tiptap/pm/tables";
import type { MarkdownNodeSpec } from "tiptap-markdown";

type SerializerState = Parameters<MarkdownNodeSpec["serialize"]>[0];

export type TableColumnAlign = "left" | "center" | "right";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    markdownTable: {
      setTableColumnAlign: (align: TableColumnAlign | null) => ReturnType;
    };
  }
}

interface TableState {
  inTable: boolean;
  out: string;
  verbatim?: [number, number][];
}

const withDelimiter = new WeakSet<object>();
const DELIMITER_CELL = /^[ \t]*:?-+:?[ \t]*$/u;
const BLANK = /^[ \t]*$/u;
const ALIGN_MARKERS: Record<TableColumnAlign, string> = { left: ":--", center: ":-:", right: "--:" };

function alignOf(value: unknown): TableColumnAlign | null {
  return value === "left" || value === "center" || value === "right" ? value : null;
}

function sourceCells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/u, "")
    .replace(/(?<!\\)\|$/u, "")
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.trim());
}

function delimiterAligns(row: string): (TableColumnAlign | null)[] {
  return sourceCells(row).map((marker) => {
    const left = marker.startsWith(":");
    const right = marker.endsWith(":");
    if (left && right) return "center";
    if (left) return "left";
    return right ? "right" : null;
  });
}

function rowSourceOf(line: string | undefined): string | null {
  return line?.replace(/\r$/u, "").replace(/^[ \t>]*/u, "") || null;
}

function isDelimiterRow(row: string): boolean {
  const parts = row.split("|");
  const first = parts[0] === "" ? 1 : 0;
  const last = BLANK.test(parts.at(-1) ?? "") ? parts.length - 1 : parts.length;
  const cells = parts.slice(first, last);
  return cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell));
}

function delimiterRowOf(line: string | undefined): string | null {
  const row = rowSourceOf(line);
  return row && isDelimiterRow(row) ? row : null;
}

function sameCells(source: unknown, cells: readonly string[]): source is string {
  if (typeof source !== "string") return false;
  const kept = sourceCells(source);
  return kept.length === cells.length && kept.every((cell, index) => cell === cells[index]);
}

function escapePipes(text: string): string {
  return text.replaceAll(/(?<!\\)((?:\\\\)*)\|/gu, "$1\\|");
}

function escapeCellPipes(out: string, start: number, verbatim: readonly [number, number][]): string {
  let result = out.slice(0, start);
  let cursor = start;
  for (const [from, to] of verbatim) {
    if (from < cursor) continue;
    result += escapePipes(out.slice(cursor, from)) + out.slice(from, to);
    cursor = to;
  }
  return result + escapePipes(out.slice(cursor));
}

export function writeVerbatim(state: SerializerState, source: string): void {
  const table = state as unknown as TableState;
  state.write("");
  const from = table.out.length;
  state.write(source);
  if (table.inTable) table.verbatim?.push([from, table.out.length]);
}

function hasSpan(cell: ProseMirrorNode): boolean {
  return Number(cell.attrs.colspan) > 1 || Number(cell.attrs.rowspan) > 1;
}

function isMarkdownTable(node: ProseMirrorNode): boolean {
  let fits = true;
  node.forEach((row, _offset, rowIndex) => {
    row.forEach((cell) => {
      const header = cell.type.name === "tableHeader";
      if ((rowIndex === 0) !== header || hasSpan(cell) || cell.childCount > 1) fits = false;
    });
  });
  return fits;
}

function delimiterFor(node: ProseMirrorNode): string {
  const aligns: (TableColumnAlign | null)[] = [];
  node.firstChild?.forEach((cell) => {
    aligns.push(alignOf(cell.attrs.align));
  });
  const kept = typeof node.attrs.delimiter === "string" ? node.attrs.delimiter : null;
  if (kept) {
    const keptAligns = delimiterAligns(kept);
    if (keptAligns.length === aligns.length && keptAligns.every((align, index) => align === aligns[index])) {
      return kept;
    }
  }
  return `| ${aligns.map((align) => (align ? ALIGN_MARKERS[align] : "---")).join(" | ")} |`;
}

export const MarkdownTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      delimiter: {
        default: null,
        rendered: false,
        parseHTML: (element) => element.dataset.delimiter ?? null,
      },
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: ["tableRow"],
        attributes: {
          markdownSource: {
            default: null,
            rendered: false,
            parseHTML: (element) => element.dataset.source ?? null,
          },
        },
      },
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          align: {
            default: null,
            parseHTML: (element) => alignOf(element.style.textAlign),
            renderHTML: (attributes) => {
              const align = alignOf(attributes.align);
              return align ? { style: `text-align: ${align}` } : {};
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setTableColumnAlign:
        (align) =>
        ({ state, tr, dispatch }) => {
          if (!isInTable(state)) return false;
          const rect = selectedRect(state);
          const cells = rect.map.cellsInRect({ left: rect.left, right: rect.right, top: 0, bottom: rect.map.height });
          if (dispatch) {
            for (const offset of cells) {
              const position = rect.tableStart + offset;
              const cell = tr.doc.nodeAt(position);
              if (cell) tr.setNodeMarkup(position, undefined, { ...cell.attrs, align });
            }
          }
          return true;
        },
    };
  },

  addStorage() {
    const markdown: MarkdownNodeSpec = {
      serialize(state, node) {
        if (!isMarkdownTable(node)) {
          state.write(getHTMLFromFragment(Fragment.from(node), node.type.schema));
          state.closeBlock(node);
          return;
        }
        const table = state as unknown as TableState;
        table.inTable = true;
        node.forEach((row, _offset, rowIndex) => {
          if (rowIndex) state.ensureNewLine();
          state.write("");
          const rowStart = table.out.length;
          const cells: string[] = [];
          state.write("| ");
          row.forEach((cell, _cellOffset, cellIndex) => {
            if (cellIndex) state.write(" | ");
            const start = table.out.length;
            const content = cell.firstChild;
            if (content?.content.size) {
              table.verbatim = [];
              state.renderInline(content);
              table.out = escapeCellPipes(table.out, start, table.verbatim);
            }
            cells.push(table.out.slice(start).trim());
          });
          state.write(" |");
          if (sameCells(row.attrs.markdownSource, cells)) {
            table.out = table.out.slice(0, rowStart) + row.attrs.markdownSource;
          }
          if (rowIndex === 0) {
            state.ensureNewLine();
            state.write(delimiterFor(node));
          }
        });
        state.closeBlock(node);
        table.inTable = false;
      },
      parse: {
        setup(markdownit) {
          if (withDelimiter.has(markdownit)) return;
          withDelimiter.add(markdownit);
          markdownit.core.ruler.after("block", "markdown_table_delimiter", (state) => {
            let lines: string[] | null = null;
            for (const token of state.tokens) {
              if ((token.type !== "table_open" && token.type !== "tr_open") || !token.map) continue;
              lines ??= state.src.split("\n");
              const row =
                token.type === "table_open" ? delimiterRowOf(lines[token.map[0] + 1]) : rowSourceOf(lines[token.map[0]]);
              if (row) token.attrSet(token.type === "table_open" ? "data-delimiter" : "data-source", row);
            }
            return true;
          });
        },
      },
    };
    return { markdown };
  },
});
