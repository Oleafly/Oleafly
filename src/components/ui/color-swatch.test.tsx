// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorPicker } from "./color-picker";
import { ColorDot, ColorSwatch } from "./color-swatch";

afterEach(() => {
  vi.useRealTimers();
});

describe("ColorSwatch", () => {
  it("is a pressed toggle named for screen readers that shows its colour name in the app tooltip", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const { container } = render(
      <>
        <ColorSwatch color="#1982c4" name="Blue" label={"Use Blue"} pressed onClick={onClick} />
        <ColorSwatch color="#e76f51" name="Coral" pressed={false} onClick={() => {}} />
      </>,
    );
    const blue = screen.getByRole("button", { name: "Use Blue" });
    expect(blue).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Coral" })).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelector("[title]")).toBeNull();
    fireEvent.click(blue);
    expect(onClick).toHaveBeenCalledOnce();
    fireEvent.mouseEnter(blue.parentElement as Element);
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Blue");
  });
});

describe("swatch edge", () => {
  it("keeps an edge apart from the colour, so a swatch the colour of the card still shows", () => {
    render(
      <>
        <ColorSwatch color="#171717" name="Card" pressed={false} onClick={() => {}} />
        <ColorSwatch color="#171717" name="Chosen" pressed onClick={() => {}} />
        <ColorPicker ariaLabel="Dark PDF page" value="#171717" onChange={() => {}} />
      </>,
    );
    const idle = screen.getByRole("button", { name: "Card" });
    expect(idle).toHaveClass("border", "border-foreground/30", "bg-clip-padding");
    const chosen = screen.getByRole("button", { name: "Chosen" });
    expect(chosen).toHaveClass("border-foreground");
    expect(chosen).not.toHaveClass("border-foreground/30");
    const picker = screen.getByLabelText("Dark PDF page").parentElement as HTMLElement;
    expect(picker).toHaveClass("border", "border-foreground/30", "bg-clip-padding");
    expect(picker.style.backgroundColor).toBe("rgb(23, 23, 23)");
  });
});

describe("ColorDot", () => {
  it("paints the colour and stays out of the accessibility tree", () => {
    const { container } = render(<ColorDot color="#1982c4" />);
    const dot = container.firstElementChild as HTMLElement;
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot.style.background).toBe("rgb(25, 130, 196)");
  });
});
