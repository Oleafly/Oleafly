// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const insertTable = vi.fn();
vi.mock("@/components/editor/latex-commands", () => ({
  insertTable: (rows: number, columns: number) => insertTable(rows, columns),
}));

import { TableSizePicker } from "./TableSizePicker";

describe("TableSizePicker", () => {
  beforeEach(() => {
    insertTable.mockClear();
  });

  it("renders all 80 dimensions and activates both boundary choices", () => {
    render(<TableSizePicker />);
    fireEvent.click(screen.getByLabelText("Insert table"));

    const choices = screen
      .getAllByRole("button")
      .filter((button) => /^\d+ by \d+ table$/u.test(button.getAttribute("aria-label") ?? ""));
    expect(choices).toHaveLength(80);

    fireEvent.click(screen.getByLabelText("1 by 1 table"));
    expect(insertTable).toHaveBeenLastCalledWith(1, 1);

    fireEvent.click(screen.getByLabelText("Insert table"));
    fireEvent.click(screen.getByLabelText("8 by 10 table"));
    expect(insertTable).toHaveBeenLastCalledWith(8, 10);
  });
});
