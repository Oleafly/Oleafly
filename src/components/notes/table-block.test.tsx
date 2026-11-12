// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as XLSX from "xlsx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROW_WINDOW_ITEM } from "@/hooks/use-row-window";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { BlockFileTooLargeError } from "./note-blocks";
import {
  OVERSCAN,
  ROW_REM,
  paintTable,
  paintTableStill,
  STILL_COLUMNS,
  STILL_ROWS,
  TableView,
  tableBlock,
  tableErrorText,
  VIEW_REM,
  VIRTUAL_AFTER,
} from "./table-block";
import { buildTable, TABLE_MAX_COLUMNS, TABLE_MAX_ROWS, type TableData, TableFileError } from "./table-data";
import "./tests/setup";

const copy = enNotes.blocks.table;
const SOURCE = "name,score,ok\nbeta,10,true\nAlpha,2.5,false\ngamma,-4,true\ndelta,,false\nepsilon,7,true";

function tableOf(text: string): TableData {
  const rows = text.split("\n").map((line) => line.split(","));
  const result = buildTable(rows);
  if (!result.ok) throw new Error("bad table");
  return result.table;
}

function bodyNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll("tbody tr[aria-rowindex]")].map((row) => row.querySelector("td")?.textContent ?? "");
}

function textUrl(text: string): string {
  return `data:text/csv;base64,${btoa(text)}`;
}

function workbookUrl(sheets: Record<string, unknown[][]>): string {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:application/octet-stream;base64,${btoa(binary)}`;
}

function preview(): HTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.documentElement.style.fontSize = "";
});

describe("TableView", () => {
  it("shows the header, the row count, aligned numbers and a summary", () => {
    const { container } = render(<TableView table={tableOf(SOURCE)} />);
    expect(screen.getByRole("button", { name: "Sort by score" })).toBeInTheDocument();
    expect(screen.getByText("5 rows")).toBeInTheDocument();
    const summary = container.querySelector("tfoot") as HTMLElement;
    expect(within(summary).getByText(copy.count).nextElementSibling).toHaveTextContent("4");
    expect(within(summary).getByText(copy.mean).nextElementSibling).toHaveTextContent("3.875");
    expect(within(summary).getByText(copy.min).nextElementSibling).toHaveTextContent("-4");
    expect(within(summary).getByText(copy.max).nextElementSibling).toHaveTextContent("10");
    expect(container.querySelector("table")).toHaveAttribute("aria-rowcount", "7");
  });

  it("tints the sticky header and summary row with the note colour and keeps the body plain", () => {
    const { container } = render(<TableView table={tableOf(SOURCE)} />);
    const heads = [...container.querySelectorAll("thead th")];
    const sums = [...container.querySelectorAll("tfoot td")];
    expect(heads).toHaveLength(3);
    for (const cell of heads) expect(cell).toHaveClass("sticky", "top-0", "bg-(--note-table-head)", "border-(--note-table-line)");
    for (const cell of sums) expect(cell).toHaveClass("sticky", "bottom-0", "bg-(--note-table-foot)", "border-(--note-table-line)");
    for (const cell of container.querySelectorAll("tbody td")) {
      expect(cell).toHaveClass("border-(--note-table-line)");
      expect(cell.className).not.toMatch(/\bbg-/u);
    }
    expect(container.querySelector(".overflow-auto")).toHaveClass("border-(--note-table-line)");
    expect(container.querySelector(".overflow-auto")).not.toHaveClass("border-border");
    expect(container.querySelector(".bg-muted")).toBeNull();
    expect(within(sums[1] as HTMLElement).getByText(copy.count)).toHaveClass("text-foreground/60");
  });

  it("cycles sorting through ascending, descending and the original order", async () => {
    const user = userEvent.setup();
    const { container } = render(<TableView table={tableOf(SOURCE)} />);
    const button = screen.getByRole("button", { name: "Sort by score" });
    const header = button.closest("th") as HTMLElement;
    expect(header).toHaveAttribute("aria-sort", "none");
    await user.click(button);
    expect(header).toHaveAttribute("aria-sort", "ascending");
    expect(bodyNames(container)).toEqual(["gamma", "Alpha", "epsilon", "beta", "delta"]);
    button.focus();
    await user.keyboard("{Enter}");
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(bodyNames(container)).toEqual(["beta", "epsilon", "Alpha", "gamma", "delta"]);
    await user.keyboard(" ");
    expect(header).toHaveAttribute("aria-sort", "none");
    expect(bodyNames(container)).toEqual(["beta", "Alpha", "gamma", "delta", "epsilon"]);
    await user.click(screen.getByRole("button", { name: "Sort by name" }));
    expect(bodyNames(container)).toEqual(["Alpha", "beta", "delta", "epsilon", "gamma"]);
    await user.click(screen.getByRole("button", { name: "Sort by score" }));
    expect(screen.getByRole("button", { name: "Sort by name" }).closest("th")).toHaveAttribute("aria-sort", "none");
  });

  it("filters rows in any column and updates the count and summary", async () => {
    const user = userEvent.setup();
    const { container } = render(<TableView table={tableOf(SOURCE)} />);
    const field = screen.getByRole("searchbox", { name: copy.filter });
    await user.type(field, "TRUE");
    await waitFor(() => expect(screen.getByText("3 of 5 rows")).toBeInTheDocument());
    expect(bodyNames(container)).toEqual(["beta", "gamma", "epsilon"]);
    const summary = container.querySelector("tfoot") as HTMLElement;
    expect(within(summary).getByText(copy.count).nextElementSibling).toHaveTextContent("3");
    await user.clear(field);
    await user.type(field, "nothing here");
    await waitFor(() => expect(screen.getByText(copy.noMatch)).toBeInTheDocument());
    expect(screen.getByText("0 of 5 rows")).toBeInTheDocument();
    expect(container.querySelector("tfoot")).toBeNull();
  });

  it("names blank headers, uses the singular count and skips the summary without numbers", () => {
    render(<TableView table={tableOf("a,\nx,y")} />);
    expect(screen.getByRole("button", { name: "Sort by Column 2" })).toBeInTheDocument();
    expect(screen.getByText("1 row")).toBeInTheDocument();
    expect(document.querySelector("tfoot")).toBeNull();
  });

  it("notes a table cut to the row limit", () => {
    const table = { ...tableOf("a\n1"), truncated: true };
    render(<TableView table={table} />);
    expect(screen.getByText(`Showing the first ${TABLE_MAX_ROWS.toLocaleString("en")} rows.`)).toBeInTheDocument();
  });

  it("draws only the visible window of a long table, measured from the rows on the page", () => {
    const rowPx = 28;
    const headPx = 30;
    let scrollTop = 0;
    const isScroller = (element: Element) => element.classList.contains("h-[24rem]");
    vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
      return isScroller(this) ? 384 : 0;
    });
    vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
      return isScroller(this) ? scrollTop : 0;
    });
    vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (this: Element, value: number) {
      if (isScroller(this)) scrollTop = value;
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.hasAttribute(ROW_WINDOW_ITEM)) return new DOMRect(0, 0, 100, rowPx);
      if (this.tagName === "TBODY") return new DOMRect(0, headPx - scrollTop, 100, 0);
      return new DOMRect(0, 0, 100, 384);
    });
    const lines = ["n,label", ...Array.from({ length: 1000 }, (_, index) => `${index},row ${index}`)];
    const { container } = render(<TableView table={tableOf(lines.join("\n"))} />);
    const rows = () => container.querySelectorAll("tbody tr[aria-rowindex]");
    const spacer = (edge: "firstElementChild" | "lastElementChild") => {
      const row = container.querySelector("tbody")?.[edge];
      return row?.hasAttribute("aria-hidden") ? row.firstElementChild : null;
    };
    const shown = Math.ceil(384 / rowPx) + OVERSCAN;
    expect(rows()).toHaveLength(shown);
    expect(spacer("firstElementChild")).toBeNull();
    expect(spacer("lastElementChild")).toHaveStyle({ height: `${(1000 - shown) * rowPx}px` });
    const scroller = container.querySelector("table")?.parentElement as HTMLElement;
    scrollTop = headPx + 500 * rowPx;
    fireEvent.scroll(scroller);
    expect(rows()[0]).toHaveAttribute("aria-rowindex", String(500 - OVERSCAN + 2));
    expect(spacer("firstElementChild")).toHaveStyle({ height: `${(500 - OVERSCAN) * rowPx}px` });
    scrollTop = headPx + 1000 * rowPx;
    fireEvent.scroll(scroller);
    expect(spacer("lastElementChild")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sort by n" }));
    expect(scrollTop).toBe(0);
    expect(rows()[0]).toHaveAttribute("aria-rowindex", "2");
  });

  it("draws a bounded first page of a long table before the rows are measured", () => {
    const lines = ["n", ...Array.from({ length: 1000 }, (_, index) => String(index))];
    const { container } = render(<TableView table={tableOf(lines.join("\n"))} />);
    expect(container.querySelectorAll("tbody tr[aria-rowindex]")).toHaveLength(Math.ceil(VIEW_REM / ROW_REM) + OVERSCAN * 2);
  });

  it("does not virtualise a short table", () => {
    const lines = ["n", ...Array.from({ length: VIRTUAL_AFTER }, (_, index) => String(index))];
    const { container } = render(<TableView table={tableOf(lines.join("\n"))} />);
    expect(container.querySelectorAll("tbody tr[aria-rowindex]")).toHaveLength(VIRTUAL_AFTER);
  });
});

describe("paintTable", () => {
  it("mounts inline data and unmounts after the current task", async () => {
    const element = preview();
    let dispose: (() => void) | undefined;
    await act(async () => {
      dispose = paintTable(element, SOURCE, { still: false, fence: "csv" });
    });
    expect(within(element).getByRole("table")).toBeInTheDocument();
    dispose?.();
    expect(within(element).getByRole("table")).toBeInTheDocument();
    await settle();
    expect(element.querySelector("table")).toBeNull();
  });

  it("reads tab separated data from a tsv fence", async () => {
    const element = preview();
    await act(async () => {
      paintTable(element, "a\tb\n1\t2", { still: false, fence: "tsv" });
    });
    expect(within(element).getByRole("button", { name: "Sort by b" })).toBeInTheDocument();
  });

  it("explains empty and too wide data", () => {
    const element = preview();
    expect(paintTable(element, "only,header", { still: false })).toBeUndefined();
    expect(element).toHaveTextContent(copy.empty);
    paintTable(element, `${Array(TABLE_MAX_COLUMNS + 1).fill("c").join(",")}\n1`, { still: false });
    expect(element).toHaveTextContent(`This table has more than ${TABLE_MAX_COLUMNS} columns.`);
  });

  it("explains bad paths and file types", () => {
    const element = preview();
    paintTable(element, "path: ../up.csv", { still: false, readFile: async () => null });
    expect(element).toHaveTextContent(copy.badPath);
    paintTable(element, "path: assets/a.json", { still: false, readFile: async () => null });
    expect(element).toHaveTextContent(copy.unsupported);
  });

  it("draws a card for a file when it can't read files", () => {
    const element = preview();
    expect(paintTable(element, "path: assets/a.csv", { still: false })).toBeUndefined();
    expect(element.querySelector("p")).toHaveTextContent(copy.label);
  });

  it("loads a file, then mounts and unmounts it", async () => {
    const element = preview();
    const dispose = paintTable(element, "path: assets/results.csv", {
      still: false,
      readFile: async (path) => (path === "assets/results.csv" ? textUrl("x,y\n1,2\n") : null),
    });
    expect(element).toHaveTextContent("Loading assets/results.csv…");
    await settle();
    expect(within(element).getByRole("table")).toBeInTheDocument();
    dispose?.();
    await settle();
    expect(element.querySelector("table")).toBeNull();
  });

  it("loads a spreadsheet sheet and names the sheets when one is missing", async () => {
    const url = workbookUrl({ Summary: [["k"], [1]], Runs: [["run"], [7]] });
    const element = preview();
    paintTable(element, "path: book.xlsx\nsheet: Runs", { still: false, readFile: async () => url });
    await settle();
    await waitFor(() => expect(within(element).getByRole("button", { name: "Sort by run" })).toBeInTheDocument());
    const other = preview();
    paintTable(other, "path: book.xlsx\nsheet: Final", { still: false, readFile: async () => url });
    await waitFor(() => expect(other).toHaveTextContent("No sheet named Final. This file has Summary and Runs."));
  });

  it("reports missing, unreadable, too large and too wide files", async () => {
    const element = preview();
    paintTable(element, "path: a.csv", { still: false, readFile: async () => null });
    await waitFor(() => expect(element).toHaveTextContent("File not found: a.csv"));
    paintTable(element, "path: a.csv", { still: false, readFile: async () => "nope" });
    await waitFor(() => expect(element).toHaveTextContent("Couldn't read a.csv."));
    paintTable(element, "path: a.csv", {
      still: false,
      readFile: async () => `data:text/csv;base64,${"A".repeat(9 * 1024 * 1024)}`,
    });
    await waitFor(() => expect(element).toHaveTextContent(copy.tooLarge));
    paintTable(element, "path: a.csv", { still: false, readFile: async () => textUrl("a,b") });
    await waitFor(() => expect(element).toHaveTextContent(copy.empty));
    const wide = workbookUrl({ Wide: [Array.from({ length: TABLE_MAX_COLUMNS + 1 }, (_, index) => index)] });
    paintTable(element, "path: wide.xlsx", { still: false, readFile: async () => wide });
    await waitFor(() => expect(element).toHaveTextContent(`more than ${TABLE_MAX_COLUMNS} columns`));
  });

  it("ignores a file that arrives after dispose", async () => {
    const element = preview();
    let finish: (value: string | null) => void = () => {};
    let fail: (error: unknown) => void = () => {};
    const dispose = paintTable(element, "path: a.csv", {
      still: false,
      readFile: () => new Promise((resolve) => (finish = resolve)),
    });
    dispose?.();
    finish(textUrl("a\n1"));
    await settle();
    expect(element).toHaveTextContent("Loading a.csv…");
    const again = paintTable(element, "path: b.csv", {
      still: false,
      readFile: () => new Promise((_, reject) => (fail = reject)),
    });
    again?.();
    fail(new Error("gone"));
    await settle();
    expect(element).toHaveTextContent("Loading b.csv…");
  });

  it("draws the still preview when asked to", () => {
    const element = preview();
    expect(paintTable(element, SOURCE, { still: true })).toBeUndefined();
    expect(element.querySelector(".note-table-still")).not.toBeNull();
  });
});

describe("tableErrorText", () => {
  const source = { kind: "file", path: "a.xlsx", format: "spreadsheet", sheet: null, thousands: false } as const;

  it("maps every problem to a message", () => {
    expect(tableErrorText(new BlockFileTooLargeError(), source)).toBe(copy.tooLarge);
    expect(tableErrorText(new TableFileError("missing"), source)).toBe("File not found: a.xlsx");
    expect(tableErrorText(new TableFileError("sheet", ["One"]), source)).toBe("No sheet named . This file has One.");
    expect(tableErrorText(new TableFileError("unreadable"), source)).toBe("Couldn't read a.xlsx.");
    expect(tableErrorText(new Error("other"), source)).toBe("Couldn't read a.xlsx.");
  });
});

describe("paintTableStill", () => {
  it("draws a plain table of the first rows and columns", () => {
    const element = preview();
    const header = Array.from({ length: STILL_COLUMNS + 2 }, (_, index) => `c${index}`).join(",");
    const rows = Array.from({ length: STILL_ROWS + 3 }, (_, index) =>
      Array.from({ length: STILL_COLUMNS + 2 }, (__, column) => (column === 0 ? `r${index}` : String(index * column))).join(","),
    );
    expect(paintTableStill(element, [header, ...rows, ","].join("\n"), { still: true, fence: "csv" })).toBeUndefined();
    const table = element.querySelector("table.note-table-still") as HTMLTableElement;
    expect(table.querySelectorAll("th")).toHaveLength(STILL_COLUMNS);
    expect(table.querySelectorAll("tbody tr")).toHaveLength(STILL_ROWS);
    expect(table.querySelectorAll("tbody tr")[0].querySelectorAll("td")).toHaveLength(STILL_COLUMNS);
    expect(element.querySelector("button, input")).toBeNull();
    for (const cell of table.querySelectorAll("th")) expect(cell).toHaveClass("bg-(--note-table-head)", "border-(--note-table-line)");
    expect(table.querySelector("td")?.className).not.toMatch(/\bbg-/u);
    expect(table.querySelector("td")).toHaveClass("border-t", "border-(--note-table-line)");
  });

  it("names blank headers", () => {
    const element = preview();
    paintTableStill(element, ",b\n1,2", { still: true });
    expect(element.querySelector("th")).toHaveTextContent("Column 1");
  });

  it("draws a card for a file and a message for empty data", () => {
    const element = preview();
    paintTableStill(element, "path: assets/a.csv\nsheet: S", { still: true });
    expect(element.querySelectorAll("p")[1]).toHaveTextContent("path: assets/a.csv");
    paintTableStill(element, "path: ../a.csv", { still: true });
    expect(element.querySelector("p")).toHaveTextContent(copy.label);
    paintTableStill(element, "just a header", { still: true });
    expect(element).toHaveTextContent(copy.empty);
  });
});

describe("tableBlock", () => {
  it("describes the csv kind and its template", () => {
    expect(tableBlock.name).toBe("csv");
    expect(tableBlock.aliases).toEqual(["tsv"]);
    expect(tableBlock.label()).toBe(copy.label);
    expect(tableBlock.interactive).toBe(true);
    expect(tableBlock.still).toBe(paintTableStill);
    const template = tableBlock.template?.();
    expect(template?.info).toBe("csv");
    const result = buildTable(
      (template?.source ?? "").split("\n").map((line) => line.split(",")),
    );
    expect(result).toMatchObject({
      ok: true,
      table: {
        header: [copy.template.sample, copy.template.temperature, copy.template.yield, copy.template.converged],
        types: ["text", "number", "number", "boolean"],
      },
    });
  });
});
