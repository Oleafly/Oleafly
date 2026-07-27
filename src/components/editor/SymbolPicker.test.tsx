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
  it("opens with the All tab active, showing every category's symbols", () => {
    render(<SymbolPicker />);
    fireEvent.click(screen.getByLabelText("Insert symbol"));
    expect(screen.getByLabelText(/^Insert alpha \(/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Insert Omega \(/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Insert right arrow \(/)).toBeInTheDocument();
  });

  it("switches to the Arrows tab and shows arrow symbols instead of Greek", () => {
    render(<SymbolPicker />);
    fireEvent.click(screen.getByLabelText("Insert symbol"));
    fireEvent.click(screen.getByText("Arrows"));
    expect(screen.getByLabelText(/^Insert right arrow \(/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Insert alpha \(/)).not.toBeInTheDocument();
  });

  it("searches across all categories by name or latex regardless of the active tab", () => {
    render(<SymbolPicker />);
    fireEvent.click(screen.getByLabelText("Insert symbol"));
    fireEvent.change(screen.getByLabelText("Search symbols"), { target: { value: "infty" } });
    expect(screen.getByLabelText(/^Insert infinity \(/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Insert alpha \(/)).not.toBeInTheDocument();
  });

  it("inserts the LaTeX macro for the clicked symbol", () => {
    render(<SymbolPicker />);
    fireEvent.click(screen.getByLabelText("Insert symbol"));
    fireEvent.click(screen.getByLabelText(/^Insert Omega \(/));
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
