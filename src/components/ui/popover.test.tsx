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

  it("opens on hover after a short wait, stays while the pointer is on it and closes once the pointer leaves", () => {
    vi.useFakeTimers();
    try {
      render(
        <Popover trigger="…" ariaLabel="Status" contentAriaLabel="Details" openOnHover closeOnClick={false}>
          {"Details text"}
        </Popover>,
      );
      const trigger = screen.getByRole("button", { name: "Status" });
      fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
      expect(screen.queryByRole("dialog", { name: "Details" })).toBeNull();
      act(() => vi.advanceTimersByTime(400));
      const details = screen.getByRole("dialog", { name: "Details" });
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(document.activeElement).not.toBe(details);
      fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
      fireEvent.pointerEnter(details, { pointerType: "mouse" });
      act(() => vi.advanceTimersByTime(400));
      expect(screen.getByRole("dialog", { name: "Details" })).toBeInTheDocument();
      fireEvent.pointerLeave(details, { pointerType: "mouse" });
      act(() => vi.advanceTimersByTime(400));
      expect(screen.queryByRole("dialog", { name: "Details" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a hovered popover open when its trigger is clicked and closes it on the next click", () => {
    vi.useFakeTimers();
    try {
      render(
        <Popover trigger="…" ariaLabel="Status" contentAriaLabel="Details" openOnHover closeOnClick={false}>
          {"Details text"}
        </Popover>,
      );
      const trigger = screen.getByRole("button", { name: "Status" });
      fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
      act(() => vi.advanceTimersByTime(400));
      expect(screen.getByRole("dialog", { name: "Details" })).toBeInTheDocument();
      open("Status");
      expect(screen.getByRole("dialog", { name: "Details" })).toBeInTheDocument();
      fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
      act(() => vi.advanceTimersByTime(400));
      expect(screen.getByRole("dialog", { name: "Details" })).toBeInTheDocument();
      open("Status");
      expect(screen.queryByRole("dialog", { name: "Details" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a hover popover from the keyboard or a click without hovering first", () => {
    render(
      <Popover trigger="…" ariaLabel="Status" contentAriaLabel="Details" openOnHover closeOnClick={false}>
        {"Details text"}
      </Popover>,
    );
    open("Status");
    expect(screen.getByRole("dialog", { name: "Details" })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Details" })).toBeNull();
  });

  it("ignores touch hovers and forgets a pending hover when the popover goes away", () => {
    vi.useFakeTimers();
    try {
      const onOpenChange = vi.fn();
      const view = render(
        <Popover trigger="…" ariaLabel="Status" contentAriaLabel="Details" openOnHover onOpenChange={onOpenChange}>
          {"Details text"}
        </Popover>,
      );
      const trigger = screen.getByRole("button", { name: "Status" });
      fireEvent.pointerEnter(trigger, { pointerType: "touch" });
      act(() => vi.advanceTimersByTime(400));
      expect(screen.queryByRole("dialog", { name: "Details" })).toBeNull();
      fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
      view.unmount();
      act(() => vi.advanceTimersByTime(400));
      expect(onOpenChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays open when the pointer comes back to the trigger of a clicked-open popover", () => {
    vi.useFakeTimers();
    try {
      render(
        <Popover trigger="…" ariaLabel="Status" contentAriaLabel="Details" openOnHover closeOnClick={false}>
          {"Details text"}
        </Popover>,
      );
      open("Status");
      const trigger = screen.getByRole("button", { name: "Status" });
      fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
      fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
      act(() => vi.advanceTimersByTime(400));
      expect(screen.getByRole("dialog", { name: "Details" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes a hovered popover at once when it becomes disabled while the pointer is leaving", () => {
    vi.useFakeTimers();
    try {
      function Harness() {
        const [disabled, setDisabled] = useState(false);
        return (
          <>
            <button type="button" onClick={() => setDisabled(true)}>
              {"Disable"}
            </button>
            <Popover trigger="…" ariaLabel="Status" contentAriaLabel="Details" openOnHover disabled={disabled}>
              {"Details text"}
            </Popover>
          </>
        );
      }
      render(<Harness />);
      const trigger = screen.getByRole("button", { name: "Status" });
      fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
      act(() => vi.advanceTimersByTime(400));
      expect(screen.getByRole("dialog", { name: "Details" })).toBeInTheDocument();
      fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
      fireEvent.click(screen.getByRole("button", { name: "Disable" }));
      expect(screen.queryByRole("dialog", { name: "Details" })).toBeNull();
      act(() => vi.advanceTimersByTime(400));
      expect(screen.queryByRole("dialog", { name: "Details" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

