// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReaderViewDialog } from "./ReaderViewDialog";

describe("ReaderViewDialog", () => {
  it("returns to the last available page when the extracted page list shrinks", () => {
    const onClose = vi.fn();
    const view = render(
      <ReaderViewDialog open pages={["First", "Second", "Third"]} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
    expect(screen.getByLabelText("Extracted text from page 3")).toHaveTextContent("Third");

    view.rerender(<ReaderViewDialog open pages={["First", "Second"]} onClose={onClose} />);
    expect(screen.getByLabelText("Extracted text from page 2")).toHaveTextContent("Second");
  });

  it("marks empty pages and closes from the dialog close control", () => {
    const onClose = vi.fn();
    render(<ReaderViewDialog open pages={["   "]} onClose={onClose} />);

    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(screen.getByText("No selectable text was found on this page.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("resets the selected page whenever the dialog closes", () => {
    const onClose = vi.fn();
    const view = render(
      <ReaderViewDialog open pages={["First", "Second"]} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Page 2" }));

    view.rerender(<ReaderViewDialog open={false} pages={["First", "Second"]} onClose={onClose} />);
    view.rerender(<ReaderViewDialog open pages={["First", "Second"]} onClose={onClose} />);
    expect(screen.getByLabelText("Extracted text from page 1")).toHaveTextContent("First");
  });
});
