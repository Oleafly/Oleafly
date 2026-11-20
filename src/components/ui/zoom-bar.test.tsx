// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { Maximize } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { ZoomBar } from "./zoom-bar";

const labels = { zoomOut: "Zoom out", zoomIn: "Zoom in", value: "Zoom level" };

describe("ZoomBar", () => {
  it("shows the level as a percentage between its step buttons and steps both ways", () => {
    const onStep = vi.fn();
    const onReset = vi.fn();
    render(
      <ZoomBar
        aria-label={"Image zoom"}
        value={1.25}
        min={0.1}
        max={8}
        onStep={onStep}
        onReset={onReset}
        resetLabel="Reset"
        labels={labels}
      />,
    );
    expect(screen.getByRole("toolbar", { name: "Image zoom" })).toBeInTheDocument();
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("125%");
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onStep.mock.calls).toEqual([[-1], [1]]);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("stops at its limits and can make the reset an icon button", () => {
    const { rerender } = render(
      <ZoomBar value={0.1} min={0.1} max={8} onStep={vi.fn()} onReset={vi.fn()} resetLabel="Fit" resetIcon={<Maximize aria-hidden />} resetDisabled labels={labels} />,
    );
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Fit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fit" }).querySelector("svg")).not.toBeNull();

    rerender(<ZoomBar value={8} min={0.1} max={8} onStep={vi.fn()} onReset={vi.fn()} resetLabel="Fit" labels={labels} />);
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fit" })).toBeEnabled();
  });
});
