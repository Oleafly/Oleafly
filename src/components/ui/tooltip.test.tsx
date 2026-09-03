// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createPortal } from "react-dom";
import { describe, expect, it } from "vitest";
import { Tooltip } from "./tooltip";

function renderTooltip(describedBy?: string) {
  const view = render(
    <Tooltip label="Rebuild the PDF">
      <button type="button" aria-describedby={describedBy}>
        Compile
      </button>
    </Tooltip>,
  );
  const trigger = screen.getByRole("button", { name: "Compile" });
  return { view, trigger, wrapper: trigger.parentElement as HTMLElement };
}

function useKeyboard() {
  fireEvent.keyDown(document, { key: "Tab" });
}

function usePointer(target: HTMLElement) {
  fireEvent.keyDown(document, { key: "Tab" });
  fireEvent.mouseDown(target);
}

describe("Tooltip", () => {
  it("opens after the hover delay and closes when the pointer leaves", async () => {
    const { wrapper } = renderTooltip();
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(wrapper);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Rebuild the PDF");

    fireEvent.mouseLeave(wrapper);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("opens when the trigger takes keyboard focus", async () => {
    const { trigger } = renderTooltip();
    useKeyboard();

    act(() => trigger.focus());

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Rebuild the PDF");
    expect(document.activeElement).toBe(trigger);
  });

  it("stays closed when a pointer click moves focus to the trigger", async () => {
    const { trigger } = renderTooltip();
    usePointer(trigger);

    act(() => trigger.focus());

    expect(screen.queryByRole("tooltip")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes when the trigger loses focus", async () => {
    const { trigger } = renderTooltip();
    useKeyboard();
    act(() => trigger.focus());
    await screen.findByRole("tooltip");

    act(() => trigger.blur());

    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("survives a blur that lands while the hover delay is still running", async () => {
    const { trigger, wrapper } = renderTooltip();
    useKeyboard();
    act(() => trigger.focus());
    await screen.findByRole("tooltip");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());

    fireEvent.mouseEnter(wrapper);
    act(() => trigger.blur());

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Rebuild the PDF");
  });

  it("closes when the trigger is pressed", async () => {
    const { trigger, wrapper } = renderTooltip();
    fireEvent.mouseEnter(wrapper);
    await screen.findByRole("tooltip");

    fireEvent.mouseDown(trigger);

    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("closes on Escape without moving focus", async () => {
    const { trigger } = renderTooltip();
    useKeyboard();
    act(() => trigger.focus());
    await screen.findByRole("tooltip");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("points the trigger at the tooltip while it is open", async () => {
    const { trigger } = renderTooltip();
    useKeyboard();
    act(() => trigger.focus());

    const tip = await screen.findByRole("tooltip");
    expect(tip.id).toMatch(/^oleafly-tooltip-/);
    expect(trigger).toHaveAttribute("aria-describedby", tip.id);
    expect(trigger).toHaveAccessibleDescription("Rebuild the PDF");

    act(() => trigger.blur());
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    expect(trigger).not.toHaveAttribute("aria-describedby");
  });

  it("keeps a description the caller already set and restores it on close", async () => {
    render(
      <p id="compile-help" hidden>
        Runs the compiler
      </p>,
    );
    const { trigger } = renderTooltip("compile-help");
    useKeyboard();
    act(() => trigger.focus());

    const tip = await screen.findByRole("tooltip");
    expect(trigger.getAttribute("aria-describedby")).toBe(`compile-help ${tip.id}`);

    act(() => trigger.blur());
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    expect(trigger.getAttribute("aria-describedby")).toBe("compile-help");
  });

  it("describes the hovered trigger too, not just the wrapper", async () => {
    const { trigger, wrapper } = renderTooltip();

    fireEvent.mouseEnter(wrapper);
    const tip = await screen.findByRole("tooltip");

    expect(trigger).toHaveAttribute("aria-describedby", tip.id);
    expect(wrapper).not.toHaveAttribute("aria-describedby");
  });

  it("ignores focus that lands in portalled content below the trigger", async () => {
    render(
      <Tooltip label="Rebuild the PDF">
        <button type="button">Compile</button>
        {createPortal(<input aria-label="Search" />, document.body)}
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Compile" });
    const field = screen.getByRole("textbox", { name: "Search" });
    useKeyboard();
    act(() => trigger.focus());
    await screen.findByRole("tooltip");

    act(() => field.focus());

    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    expect(document.activeElement).toBe(field);
    expect(trigger).not.toHaveAttribute("aria-describedby");
  });

  it("does not reopen after Escape when the pointer only passes over", async () => {
    const { trigger, wrapper } = renderTooltip();
    useKeyboard();
    act(() => trigger.focus());
    await screen.findByRole("tooltip");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());

    fireEvent.mouseEnter(wrapper);
    fireEvent.mouseLeave(wrapper);

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes when the trigger is activated from the keyboard", async () => {
    const { trigger } = renderTooltip();
    useKeyboard();
    act(() => trigger.focus());
    await screen.findByRole("tooltip");

    fireEvent.click(trigger);

    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
