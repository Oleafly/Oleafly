// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BlockFrame } from "./block-frame";

describe("BlockFrame", () => {
  it("shows the label, the body and the actions after the body in reading order", () => {
    render(
      <BlockFrame label={"Chart"} actions={<button type="button">{"Source"}</button>} data-block="chart">
        <svg data-testid="plot" />
      </BlockFrame>,
    );
    const plot = screen.getByTestId("plot");
    const action = screen.getByRole("button", { name: "Source" });
    expect(screen.getByText("Chart")).toBeInTheDocument();
    expect(plot.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(plot.parentElement).toHaveAttribute("data-block", "chart");
  });

  it("shows a message in place of the body when there is nothing to draw", () => {
    render(
      <BlockFrame label={"Chart"} message="This chart has no rows.">
        <svg data-testid="plot" />
      </BlockFrame>,
    );
    expect(screen.getByText("This chart has no rows.")).toBeInTheDocument();
    expect(screen.queryByTestId("plot")).toBeNull();
  });
});
