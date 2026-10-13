// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./code-block";
import { CopyableBlock } from "./copyable-block";

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

describe("CodeBlock", () => {
  it("shows the code in a selectable block with a copy button in its corner", async () => {
    render(<CodeBlock code={"\\begin{table}\n\\end{table}"} data-testid="block" />);
    const block = screen.getByTestId("block");
    expect(block.tagName).toBe("PRE");
    expect(block).toHaveTextContent("\\begin{table}");
    expect(block).toHaveClass("select-text");
    const copy = screen.getByRole("button", { name: "Copy" });
    expect(copy).toHaveClass("opacity-0", "group-hover/code-block:opacity-100", "group-focus-within/code-block:opacity-100");
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("\\begin{table}\n\\end{table}");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("copies the code even when it shows something richer", () => {
    render(
      <CodeBlock code='{"a": 1}' preClassName="max-h-96">
        <code>
          <span className="text-sky-700">{'"a"'}</span>
          {": 1"}
        </code>
      </CodeBlock>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith('{"a": 1}');
  });

  it("reports a copy the clipboard refused", async () => {
    const refused = new Error("Document is not focused.");
    writeText.mockRejectedValueOnce(refused);
    const onCopyError = vi.fn();
    render(<CodeBlock code="x" onCopyError={onCopyError} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await vi.waitFor(() => expect(onCopyError).toHaveBeenCalledExactlyOnceWith(refused));
  });
});

describe("CopyableBlock", () => {
  it("wraps any content and takes its own labels", async () => {
    render(
      <CopyableBlock source="graph TD; A-->B" copyLabel="Copy diagram source" copiedLabel="Diagram source copied">
        <svg data-testid="diagram" />
      </CopyableBlock>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy diagram source" }));
    expect(writeText).toHaveBeenCalledWith("graph TD; A-->B");
    expect(await screen.findByRole("button", { name: "Diagram source copied" })).toBeInTheDocument();
  });
});
