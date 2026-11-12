// @vitest-environment jsdom
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Listbox, ListboxHeading, ListboxOption } from "./listbox";

const FILES = "Files";

describe("Listbox", () => {
  it("renders options that highlight on hover, choose on click and never take focus", () => {
    const onHighlight = vi.fn();
    const onChoose = vi.fn();
    render(
      <Listbox aria-label={FILES}>
        <ListboxHeading>{"Recent"}</ListboxHeading>
        <ListboxOption id="a" selected onChoose={vi.fn()}>
          {"Alpha"}
        </ListboxOption>
        <ListboxOption id="b" selected={false} onHighlight={onHighlight} onChoose={onChoose}>
          {"Beta"}
        </ListboxOption>
      </Listbox>,
    );
    expect(screen.getByRole("listbox", { name: FILES })).toHaveTextContent("Recent");
    const [alpha, beta] = screen.getAllByRole("option");
    expect(alpha).toHaveAttribute("aria-selected", "true");
    expect(beta).toHaveAttribute("aria-selected", "false");
    expect(beta).toHaveAttribute("tabindex", "-1");

    fireEvent.mouseEnter(alpha);
    fireEvent.mouseEnter(beta);
    expect(onHighlight).toHaveBeenCalledOnce();

    const press = createEvent.mouseDown(beta);
    fireEvent(beta, press);
    expect(press.defaultPrevented).toBe(true);
    fireEvent.click(beta);
    expect(onChoose).toHaveBeenCalledOnce();
  });
});
