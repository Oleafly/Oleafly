// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  nextSort,
  SortableTableHead,
  type SortState,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableSpacerRow,
} from "./table";

describe("Table", () => {
  it("lays out a captioned table with right-aligned numeric columns", () => {
    render(
      <Table className="custom">
        <TableCaption>{"Word counts"}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{"Chapter"}</TableHead>
            <TableHead numeric>{"Words"}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>{"Intro"}</TableCell>
            <TableCell numeric>{"1200"}</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>{"Total"}</TableCell>
            <TableCell numeric>{"1200"}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    );

    const table = screen.getByRole("table", { name: "Word counts" });
    expect(table.className).toContain("custom");
    const [chapter, words] = within(table).getAllByRole("columnheader");
    expect(chapter.className).not.toContain("text-right");
    expect(words.className).toContain("text-right");
    const cells = within(table).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual(["Intro", "1200", "Total", "1200"]);
    expect(cells[0].className).not.toContain("text-right");
    expect(cells[1].className).toContain("text-right");
    expect(table.querySelector("tfoot")?.textContent).toBe("Total1200");
  });

  it("sorts from a header button and tells assistive tech the current order", () => {
    const onSort = vi.fn();
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <SortableTableHead label={"Chapter"} sortLabel="Sort by chapter" direction="descending" onSort={onSort} />
            <SortableTableHead label={"Words"} sortLabel="Sort by words" direction={null} onSort={() => {}} numeric />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableSpacerRow height={40} span={2} />
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole("columnheader", { name: "Chapter" })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("columnheader", { name: "Words" })).toHaveAttribute("aria-sort", "none");
    fireEvent.click(screen.getByRole("button", { name: "Sort by chapter" }));
    expect(onSort).toHaveBeenCalledOnce();
    expect(screen.queryAllByRole("cell")).toEqual([]);
  });
});

describe("nextSort", () => {
  const by = (key: string, direction: SortState<string>["direction"]) => ({ key, direction });

  it.each([
    [null, "a", undefined, by("a", "ascending")],
    [by("a", "ascending"), "b", "descending" as const, by("b", "descending")],
    [by("a", "ascending"), "a", undefined, by("a", "descending")],
    [by("a", "descending"), "a", undefined, by("a", "ascending")],
    [by("a", "descending"), "a", "descending" as const, by("a", "ascending")],
  ])("from %o on %s starting %s gives %o", (current, key, first, expected) => {
    expect(nextSort(current, key, first)).toEqual(expected);
  });

  it("clears a clearable sort after both directions", () => {
    const first = nextSort(null, "a", "ascending", true);
    const second = nextSort(first, "a", "ascending", true);
    expect(second).toEqual(by("a", "descending"));
    expect(nextSort(second, "a", "ascending", true)).toBeNull();
  });
});
