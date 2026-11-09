// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipIconButton } from "./tooltip-icon-button";

const ZOOM = "Zoom in";
const TODAY = "Today's note";
const TODAY_HELP = "Today's note (Ctrl+Alt+D)";

describe("TooltipIconButton", () => {
  it("names the icon button and shows its label in the app tooltip on hover", async () => {
    const onClick = vi.fn();
    render(
      <TooltipIconButton label={ZOOM} onClick={onClick}>
        <svg aria-hidden />
      </TooltipIconButton>,
    );
    const button = screen.getByRole("button", { name: ZOOM });
    expect(button).not.toHaveAttribute("title");
    expect(button).toHaveClass("size-7");
    fireEvent.mouseEnter(button.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(ZOOM);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("can show richer hover help than its name and pass button props through", async () => {
    render(
      <TooltipIconButton label={TODAY} tooltip={TODAY_HELP} disabled className="relative bg-accent" aria-pressed>
        <svg aria-hidden />
      </TooltipIconButton>,
    );
    const button = screen.getByRole("button", { name: TODAY });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveClass("relative", "bg-accent", "size-7");
    fireEvent.mouseEnter(button.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(TODAY_HELP);
  });
});
