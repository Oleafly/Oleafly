import { Table2 } from "lucide-react";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseDelimited, serializeCsv } from "@oleafly/conversion-registry/table";
import { BLOCK_SURFACE } from "@/components/ui/block-frame";
import { Input } from "@/components/ui/input";
import { nextSort, SortableTableHead, type SortState, TableSpacerRow } from "@/components/ui/table";
import { ROW_WINDOW_ITEM, useRowWindow } from "@/hooks/use-row-window";
import { i18n } from "@/i18n";
import { formatList, formatNumber, textCollator } from "@/lib/intl";
import { cn } from "@/lib/utils";
import {
  BlockFileTooLargeError,
  type BlockPaint,
  blockMessage,
  type Dispose,
  type NoteBlockKind,
  element,
  type PaintContext,
  paintAsync,
  paintBlockCard,
} from "./note-blocks";
import {
  buildTable,
  type ColumnSummary,
  columnKeyCache,
  filterRows,
  loadTableFile,
  sortRows,
  summarizeColumn,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  type TableData,
  TableFileError,
  type TableResult,
  type TableSource,
  tableDelimiter,
  tableSource,
} from "./table-data";
import { nodeRoot } from "./node-root";

export const VIRTUAL_AFTER = 200;
export const ROW_REM = 1.75;
export const VIEW_REM = 24;
export const OVERSCAN = 8;
export const STILL_ROWS = 6;
export const STILL_COLUMNS = 6;
const FIRST_WINDOW = Math.ceil(VIEW_REM / ROW_REM) + OVERSCAN * 2;
const MEAN_FORMAT: Intl.NumberFormatOptions = { maximumSignificantDigits: 6 };
const TABLE_LINE = "border-(--note-table-line)";
const TABLE_HEAD = "bg-(--note-table-head)";

function columnName(name: string, index: number): string {
  return name.trim() || i18n.t(($) => $.notes.blocks.table.column, { number: index + 1 });
}

function SummaryCell({ summary }: Readonly<{ summary: ColumnSummary }>) {
  const { t } = useTranslation(["notes"]);
  const items: [string, string][] = [
    [t(($) => $.notes.blocks.table.count), formatNumber(summary.count)],
    [t(($) => $.notes.blocks.table.mean), formatNumber(summary.mean, MEAN_FORMAT)],
    [t(($) => $.notes.blocks.table.min), summary.minText],
    [t(($) => $.notes.blocks.table.max), summary.maxText],
  ];
  return (
    <dl className="flex flex-wrap justify-end gap-x-3 gap-y-0.5 text-[0.6875rem]">
      {items.map(([label, value]) => (
        <div key={label} className="inline-flex gap-1 whitespace-nowrap">
          <dt className="text-foreground/60">{label}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TableView({ table }: Readonly<{ table: TableData }>) {
  const { t } = useTranslation(["notes"]);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState<number> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const query = useDeferredValue(filter);
  const collator = textCollator();
  const keys = useMemo(() => columnKeyCache(table), [table]);
  const filtered = useMemo(() => filterRows(table, query), [table, query]);
  const order = useMemo(
    () => (sort ? sortRows(filtered, keys(sort.key), sort.direction, collator) : filtered),
    [filtered, sort, keys, collator],
  );
  const summaries = useMemo(
    () =>
      table.types.map((type, column) =>
        type === "number" ? summarizeColumn(table, filtered, keys(column), column) : null,
      ),
    [table, filtered, keys],
  );
  const columns = useMemo(
    () =>
      table.header.map((name, index) => ({
        id: `${index}:${name}`,
        index,
        label: columnName(name, index),
        numeric: table.types[index] === "number",
      })),
    [table],
  );
  const hasSummary = summaries.some(Boolean);
  const width = columns.length;
  const total = table.rows.length;
  const virtual = order.length > VIRTUAL_AFTER;
  const shown = useRowWindow({ count: order.length, scrollRef, listRef: bodyRef, overscan: OVERSCAN, unmeasuredCount: FIRST_WINDOW });
  const { start, end, paddingTop, paddingBottom } = virtual
    ? shown
    : { start: 0, end: order.length, paddingTop: 0, paddingBottom: 0 };

  const toTop = () => {
    (scrollRef.current as HTMLDivElement).scrollTop = 0;
  };

  const countText =
    order.length === total
      ? t(($) => $.notes.blocks.table.rows, { count: total, total: formatNumber(total) })
      : t(($) => $.notes.blocks.table.filtered, {
          count: total,
          shown: formatNumber(order.length),
          total: formatNumber(total),
        });

  return (
    <div className="note-table w-full min-w-0 select-text">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            toTop();
          }}
          aria-label={t(($) => $.notes.blocks.table.filter)}
          placeholder={t(($) => $.notes.blocks.table.filter)}
          className="h-7 w-56 max-w-full px-2 py-0 text-xs"
        />
        <p className="ms-auto text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {countText}
        </p>
      </div>
      {table.truncated ? (
        <p className="mb-2 text-[0.6875rem] text-muted-foreground">
          {t(($) => $.notes.blocks.table.truncated, { limit: formatNumber(TABLE_MAX_ROWS) })}
        </p>
      ) : null}
      <div ref={scrollRef} className={cn(BLOCK_SURFACE, TABLE_LINE, "overflow-auto", virtual ? "h-[24rem]" : "max-h-[24rem]")}>
        <table
          className="w-full border-separate border-spacing-0 text-xs"
          aria-rowcount={order.length + (hasSummary ? 2 : 1)}
        >
          <thead>
            <tr aria-rowindex={1}>
              {columns.map(({ id, index: column, label, numeric }) => (
                <SortableTableHead
                  key={id}
                  label={<span className="max-w-[24rem] truncate">{label}</span>}
                  sortLabel={t(($) => $.notes.blocks.table.sortBy, { column: label })}
                  direction={sort?.key === column ? sort.direction : null}
                  numeric={numeric}
                  onSort={() => {
                    setSort((current) => nextSort(current, column, "ascending", true));
                    toTop();
                  }}
                  className={cn("sticky top-0 z-[1] border-b", TABLE_LINE, TABLE_HEAD)}
                />
              ))}
            </tr>
          </thead>
          <tbody ref={bodyRef} className="[&>tr:last-child>td]:border-b-0">
            {paddingTop > 0 ? <TableSpacerRow height={paddingTop} span={width} /> : null}
            {order.slice(start, end).map((rowIndex, offset) => (
              <tr
                key={rowIndex}
                {...{ [ROW_WINDOW_ITEM]: "" }}
                aria-rowindex={start + offset + 2}
                style={{ height: `${ROW_REM}rem` }}
                className="hover:bg-muted/40"
              >
                {columns.map(({ id, index: column, numeric }) => (
                  <td key={id} className={cn("border-b px-2 py-1", TABLE_LINE, numeric && "text-right tabular-nums")}>
                    <span className="block max-w-[32rem] truncate whitespace-nowrap">{table.rows[rowIndex][column]}</span>
                  </td>
                ))}
              </tr>
            ))}
            {paddingBottom > 0 ? <TableSpacerRow height={paddingBottom} span={width} /> : null}
            {order.length === 0 ? (
              <tr>
                <td colSpan={width} className="px-2 py-4 text-center text-muted-foreground">
                  {t(($) => $.notes.blocks.table.noMatch)}
                </td>
              </tr>
            ) : null}
          </tbody>
          {hasSummary ? (
            <tfoot>
              <tr aria-rowindex={order.length + 2}>
                {columns.map(({ id, index: column }) => {
                  const summary = summaries[column];
                  return (
                    <td key={id} className={cn("sticky bottom-0 border-t bg-(--note-table-foot) px-2 py-1 align-top", TABLE_LINE)}>
                      {summary ? <SummaryCell summary={summary} /> : null}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

export function mountTable(host: HTMLElement, table: TableData): Dispose {
  const root = nodeRoot(host);
  root.render(<TableView table={table} />);
  return root.unmount;
}

function tableLabel(): string {
  return i18n.t(($) => $.notes.blocks.table.label);
}

function problemText(problem: "empty" | "columns"): string {
  return problem === "empty"
    ? i18n.t(($) => $.notes.blocks.table.empty)
    : i18n.t(($) => $.notes.blocks.table.columns, { limit: TABLE_MAX_COLUMNS });
}

function invalidText(source: Extract<TableSource, { kind: "invalid" }>): string {
  return source.problem === "path"
    ? i18n.t(($) => $.notes.blocks.table.badPath)
    : i18n.t(($) => $.notes.blocks.table.unsupported);
}

function sheetList(sheets: readonly string[]): string {
  return formatList(sheets);
}

export function tableErrorText(error: unknown, source: Extract<TableSource, { kind: "file" }>): string {
  if (error instanceof BlockFileTooLargeError) return i18n.t(($) => $.notes.blocks.table.tooLarge);
  if (error instanceof TableFileError) {
    if (error.problem === "missing") return i18n.t(($) => $.notes.blocks.table.missing, { path: source.path });
    if (error.problem === "columns") return problemText("columns");
    if (error.problem === "sheet") {
      return i18n.t(($) => $.notes.blocks.table.noSheet, {
        sheet: source.sheet ?? "",
        sheets: sheetList(error.sheets),
      });
    }
  }
  return i18n.t(($) => $.notes.blocks.table.unreadable, { path: source.path });
}

function showTable(preview: HTMLElement, result: TableResult): Dispose | undefined {
  if (!result.ok) {
    blockMessage(preview, problemText(result.problem));
    return undefined;
  }
  const host = element("div", "note-table-host w-full min-w-0");
  preview.replaceChildren(host);
  return mountTable(host, result.table);
}

function inlineRows(text: string, fence: string | undefined, limit?: number): string[][] {
  return parseDelimited(text, { delimiter: tableDelimiter(fence, text), limit: limit ?? TABLE_MAX_ROWS + 2, trim: false });
}

export const paintTableStill: BlockPaint = (preview, source, context) => {
  const spec = tableSource(source);
  if (spec.kind !== "inline") {
    paintBlockCard(preview, tableLabel(), source);
    return undefined;
  }
  const result = buildTable(inlineRows(spec.text, context.fence, STILL_ROWS + 1), spec.thousands);
  if (!result.ok) {
    blockMessage(preview, problemText(result.problem));
    return undefined;
  }
  const { header, rows, types } = result.table;
  const table = element("table", "note-table-still w-full border-collapse text-xs");
  const head = element("tr", "");
  header.slice(0, STILL_COLUMNS).forEach((name, column) => {
    const numeric = types[column] === "number";
    const cell = element("th", cn("border-b px-2 py-1 font-medium", TABLE_LINE, TABLE_HEAD, numeric ? "text-right" : "text-left"), columnName(name, column));
    cell.scope = "col";
    head.append(cell);
  });
  const thead = element("thead", "");
  thead.append(head);
  const tbody = element("tbody", "");
  for (const row of rows) {
    const line = element("tr", "");
    row.slice(0, STILL_COLUMNS).forEach((value, column) => {
      line.append(element("td", cn("border-t px-2 py-1", TABLE_LINE, types[column] === "number" && "text-right tabular-nums"), value));
    });
    tbody.append(line);
  }
  table.append(thead, tbody);
  preview.replaceChildren(table);
  return undefined;
};

export function paintTable(preview: HTMLElement, source: string, context: PaintContext): Dispose | undefined {
  if (context.still) return paintTableStill(preview, source, context);
  const spec = tableSource(source);
  if (spec.kind === "invalid") {
    blockMessage(preview, invalidText(spec));
    return undefined;
  }
  if (spec.kind === "inline") {
    return showTable(preview, buildTable(inlineRows(spec.text, context.fence), spec.thousands));
  }
  const { readFile } = context;
  if (!readFile) {
    paintBlockCard(preview, tableLabel(), source);
    return undefined;
  }
  return paintAsync(preview, {
    loading: i18n.t(($) => $.notes.blocks.table.loading, { path: spec.path }),
    load: () => loadTableFile(spec, readFile),
    show: (result) => showTable(preview, result),
    error: (error) => tableErrorText(error, spec),
  });
}

function templateSource(): string {
  const header = [
    i18n.t(($) => $.notes.blocks.table.template.sample),
    i18n.t(($) => $.notes.blocks.table.template.temperature),
    i18n.t(($) => $.notes.blocks.table.template.yield),
    i18n.t(($) => $.notes.blocks.table.template.converged),
  ];
  const rows = [
    ["A1", "25", "61.2", "true"],
    ["A2", "40", "68.9", "true"],
    ["A3", "55", "72.4", "false"],
    ["B1", "25", "58.0", "true"],
    ["B2", "40", "66.3", "true"],
  ];
  return serializeCsv([header, ...rows]).replace(/\n$/u, "");
}

export const tableBlock: NoteBlockKind = {
  name: "csv",
  aliases: ["tsv"],
  label: tableLabel,
  icon: Table2,
  paint: paintTable,
  still: paintTableStill,
  interactive: true,
  template: () => ({ info: "csv", source: templateSource() }),
};
