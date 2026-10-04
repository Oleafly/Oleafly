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

  it("hands the chosen size to a custom inserter instead of LaTeX", () => {
    const onPick = vi.fn();
    render(<TableSizePicker onPick={onPick} />);
    fireEvent.click(screen.getByLabelText("Insert table"));
    fireEvent.click(screen.getByLabelText("3 by 4 table"));
    expect(onPick).toHaveBeenCalledWith(3, 4);
    expect(insertTable).not.toHaveBeenCalled();
  });

  it("previews the hovered size and fills the grid up to it", () => {
    render(<TableSizePicker />);
    fireEvent.click(screen.getByLabelText("Insert table"));
    expect(screen.getByText("Select size")).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByLabelText("2 by 3 table"));
    expect(screen.getByText("2 × 3")).toBeInTheDocument();
    expect(screen.getByLabelText("1 by 1 table")).toHaveClass("bg-primary/20");
    expect(screen.getByLabelText("2 by 3 table")).toHaveClass("bg-primary/20");
    expect(screen.getByLabelText("3 by 3 table")).not.toHaveClass("bg-primary/20");
    expect(screen.getByLabelText("2 by 4 table")).not.toHaveClass("bg-primary/20");
  });

  it("labels the trigger as a menu row when asked", () => {
    render(<TableSizePicker menuRow />);
    expect(screen.getByLabelText("Insert table")).toHaveTextContent("Table");
  });
});
