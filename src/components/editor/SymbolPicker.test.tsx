// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const insertAtCursor = vi.fn();
const insertTypstSymbol = vi.fn(async (_latex: string, _glyph: string) => {});
vi.mock("@/components/editor/cm/controller", () => ({
  insertAtCursor: (text: string) => insertAtCursor(text),
}));
vi.mock("@/components/editor/typst-commands", () => ({
  insertTypstSymbol: (latex: string, glyph: string) => insertTypstSymbol(latex, glyph),
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
    expect(new Set(symbols.map((symbol) => symbol.name())).size).toBe(
      symbols.length,
    );

    for (const symbol of symbols) {
      insertToolbarSymbol(symbol);
      expect(insertAtCursor).toHaveBeenLastCalledWith(symbol.latex);
    }
    expect(insertAtCursor).toHaveBeenCalledTimes(symbols.length);
  });

  it("shows Typst names and inserts through the Typst path in a Typst file", async () => {
    insertAtCursor.mockClear();
    render(<SymbolPicker language="typst" />);
    fireEvent.click(screen.getByLabelText("Insert symbol"));
    await waitFor(() => expect(screen.getByLabelText("Insert right arrow (arrow.r)")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Search symbols"), { target: { value: "chevron" } });
    expect(screen.getByLabelText(/^Insert left angle bracket \(chevron\.l\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/^Insert left angle bracket \(chevron\.l\)/));
    expect(insertTypstSymbol).toHaveBeenCalledWith("\\langle", "⟨");
    expect(insertAtCursor).not.toHaveBeenCalled();
  });

  it("routes every inventory item through the Typst insertion in Typst mode", () => {
    insertTypstSymbol.mockClear();
    const symbols = SYMBOL_CATEGORIES.flatMap((category) => category.items);
    for (const symbol of symbols) insertToolbarSymbol(symbol, "typst");
    expect(insertTypstSymbol).toHaveBeenCalledTimes(symbols.length);
    expect(insertTypstSymbol).toHaveBeenLastCalledWith(symbols.at(-1)?.latex, symbols.at(-1)?.char);
  });
});
