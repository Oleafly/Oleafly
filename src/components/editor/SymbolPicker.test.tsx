// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const insertAtCursor = vi.fn();
vi.mock("@/components/editor/cm/controller", () => ({
  insertAtCursor: (text: string) => insertAtCursor(text),
}));

import {
  SYMBOL_CATEGORIES,
  SymbolPicker,
  insertToolbarSymbol,
} from "./SymbolPicker";

describe("SymbolPicker", () => {
  it("opens with the Greek tab active by default", () => {
    render(<SymbolPicker />);
    fireEvent.click(screen.getByLabelText("Insert symbol"));
    expect(screen.getByTitle("alpha")).toBeInTheDocument();
    expect(screen.getByTitle("Omega")).toBeInTheDocument();
  });

  it("switches to the Arrows tab and shows arrow symbols instead of Greek", () => {
    render(<SymbolPicker />);
    fireEvent.click(screen.getByLabelText("Insert symbol"));
    fireEvent.click(screen.getByText("Arrows"));
    expect(screen.getByTitle("rightarrow")).toBeInTheDocument();
    expect(screen.queryByTitle("alpha")).not.toBeInTheDocument();
  });

  it("searches across all categories regardless of the active tab", () => {
    render(<SymbolPicker />);
    fireEvent.click(screen.getByLabelText("Insert symbol"));
    fireEvent.change(screen.getByLabelText("Search symbols"), { target: { value: "infty" } });
    expect(screen.getByTitle("infty")).toBeInTheDocument();
    expect(screen.queryByTitle("alpha")).not.toBeInTheDocument();
  });

  it("inserts the LaTeX macro for the clicked symbol", () => {
    render(<SymbolPicker />);
    fireEvent.click(screen.getByLabelText("Insert symbol"));
    fireEvent.click(screen.getByTitle("Omega"));
    expect(insertAtCursor).toHaveBeenCalledWith("\\Omega");
  });

  it("routes every inventory item through the production insertion function", () => {
    insertAtCursor.mockClear();
    const symbols = SYMBOL_CATEGORIES.flatMap((category) => category.items);
    expect(symbols.length).toBeGreaterThan(100);
    expect(new Set(symbols.map((symbol) => symbol.name)).size).toBe(
      symbols.length,
    );

    for (const symbol of symbols) {
      insertToolbarSymbol(symbol);
      expect(insertAtCursor).toHaveBeenLastCalledWith(symbol.latex);
    }
    expect(insertAtCursor).toHaveBeenCalledTimes(symbols.length);
  });
});
