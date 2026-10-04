// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
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
});
