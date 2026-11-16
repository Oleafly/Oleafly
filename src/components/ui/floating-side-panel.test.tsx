// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FloatingSidePanel } from "./floating-side-panel";

const TITLE = "Notes";
const CLOSE = "Close notes";
const BODY = "Panel body";

describe("FloatingSidePanel", () => {
  it("shows a titled panel whose close button calls onClose", () => {
    const onClose = vi.fn();
    render(
      <FloatingSidePanel id="notes" open side="right" title={TITLE} closeLabel={CLOSE} onClose={onClose}>
        <p>{BODY}</p>
      </FloatingSidePanel>,
    );

    const panel = screen.getByRole("complementary", { name: TITLE });
    expect(panel).toHaveAttribute("id", "notes");
    expect(panel).not.toHaveAttribute("inert");
    expect(panel).toHaveClass("right-2", "translate-x-0");
    expect(screen.getByRole("heading", { name: TITLE })).toBeInTheDocument();
    expect(screen.getByText(BODY)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: CLOSE }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("slides out towards its own edge and goes inert when closed", () => {
    const { container, rerender } = render(
      <FloatingSidePanel open={false} side="left" title={TITLE} closeLabel={CLOSE} onClose={vi.fn()}>
        {BODY}
      </FloatingSidePanel>,
    );
    const panel = container.querySelector("aside") as HTMLElement;
    expect(panel).toHaveClass("left-2", "-translate-x-[calc(100%_+_1rem)]");
    expect(panel).toHaveAttribute("inert");

    rerender(
      <FloatingSidePanel open={false} side="right" title={TITLE} closeLabel={CLOSE} onClose={vi.fn()}>
        {BODY}
      </FloatingSidePanel>,
    );
    expect(panel).toHaveClass("right-2", "translate-x-[calc(100%_+_1rem)]");
  });

  it("takes a width, a separate accessible name and header actions", () => {
    render(
      <FloatingSidePanel
        open
        side="right"
        title={TITLE}
        ariaLabel="Annotation list"
        closeLabel={CLOSE}
        onClose={vi.fn()}
        width="20rem"
        headerActions={<button type="button">{"Export"}</button>}
      >
        {BODY}
      </FloatingSidePanel>,
    );
    const panel = screen.getByRole("complementary", { name: "Annotation list" });
    expect(panel.style.getPropertyValue("--floating-side-panel-width")).toBe("20rem");
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });
});
