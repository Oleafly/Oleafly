// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Popover, PopoverItem } from "./popover";

const NESTED_LABEL = "Nested";

async function settle() {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

function open(name = "Options") {
  const trigger = screen.getByRole("button", { name });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

describe("Popover", () => {
  it("opens from its trigger and closes after an item is chosen", () => {
    const choose = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <Popover trigger="…" ariaLabel="Options" contentAriaLabel="Option list" onOpenChange={onOpenChange}>
        <PopoverItem onClick={choose}>{"Rename"}</PopoverItem>
      </Popover>,
    );

    open();
    expect(screen.getByRole("dialog", { name: "Option list" })).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    expect(choose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Option list" })).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("stays open on clicks inside when it holds a form", async () => {
    render(
      <Popover trigger="…" ariaLabel="Options" contentAriaLabel="Filters" closeOnClick={false}>
        <label>
          {"Only mine"}
          <input type="checkbox" />
        </label>
        <div role="listbox" aria-label={NESTED_LABEL}>
          <div role="option" aria-selected="false" tabIndex={-1}>
            {"Choice"}
          </div>
        </div>
      </Popover>,
    );

    open();
    await settle();
    fireEvent.click(screen.getByRole("checkbox", { name: "Only mine" }));
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();

    const nested = document.createElement("div");
    nested.setAttribute("role", "listbox");
    document.body.append(nested);
    fireEvent.pointerDown(nested);
    fireEvent.focus(nested);
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();
    nested.remove();

    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();
  });

  it("does not open while disabled and closes when it becomes disabled", () => {
    function Harness() {
      const [disabled, setDisabled] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setDisabled((value) => !value)}>
            {"Toggle"}
          </button>
          <Popover trigger="…" ariaLabel="Options" contentAriaLabel="Menu" disabled={disabled} triggerClassName="px-2">
            {"Content"}
          </Popover>
        </>
      );
    }
    render(<Harness />);

    open();
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    expect(screen.getByRole("button", { name: "Options" })).toBeDisabled();

    open();
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
  });
});

