// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));

import { AppZoom, useAppZoomFeedback, zoomApp } from "@/lib/app-zoom";
import { useSettingsStore } from "@/store/settings";
import { APP_ZOOM_INDICATOR_MS, AppZoomIndicator } from "./AppZoomIndicator";

const copy = enShell.zoomIndicator;
const commands = enShell.commands;

function bar() {
  return screen.getByRole("toolbar", { name: copy.label });
}

function button(name: string | RegExp) {
  return screen.getByRole("button", { name });
}

function shownAt(level: number) {
  act(() => {
    useSettingsStore.getState().setAppZoom(level);
    useAppZoomFeedback.setState({ shown: 1 });
  });
  render(<AppZoomIndicator />);
}

beforeEach(() => {
  useSettingsStore.getState().setAppZoom(100);
  useAppZoomFeedback.setState({ shown: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("AppZoomIndicator", () => {
  it("stays out of the page until the app zooms, and not for a change made in Settings", async () => {
    render(<AppZoom />);
    act(() => useSettingsStore.getState().setAppZoom(150));
    expect(screen.queryByRole("toolbar")).toBeNull();

    act(() => zoomApp(1));
    expect(await screen.findByRole("toolbar", { name: copy.label })).toHaveTextContent("175%");
  });

  it("steps with plus and minus, resets to 100%, and stops each control at its limit", () => {
    shownAt(100);
    expect(button(copy.reset)).toBeDisabled();

    fireEvent.click(button(commands.zoomIn.label));
    expect(bar()).toHaveTextContent("110%");
    expect(button(copy.reset)).toBeEnabled();
    fireEvent.click(button(commands.zoomOut.label));
    fireEvent.click(button(commands.zoomOut.label));
    expect(bar()).toHaveTextContent("90%");
    fireEvent.click(button(copy.reset));
    expect(useSettingsStore.getState().appZoom).toBe(100);

    act(() => useSettingsStore.getState().setAppZoom(200));
    expect(button(commands.zoomIn.label)).toBeDisabled();
    expect(button(commands.zoomOut.label)).toBeEnabled();
    act(() => useSettingsStore.getState().setAppZoom(80));
    expect(button(commands.zoomOut.label)).toBeDisabled();
    expect(button(commands.zoomIn.label)).toBeEnabled();
  });

  it("hides after a short pause, and each zoom starts the pause again", () => {
    vi.useFakeTimers();
    shownAt(110);
    expect(bar()).toHaveAttribute("data-state", "open");

    act(() => vi.advanceTimersByTime(APP_ZOOM_INDICATOR_MS - 1));
    act(() => zoomApp(1));
    act(() => vi.advanceTimersByTime(APP_ZOOM_INDICATOR_MS - 1));
    expect(bar()).toHaveAttribute("data-state", "open");
    expect(bar()).toHaveTextContent("125%");

    act(() => vi.advanceTimersByTime(1));
    expect(bar()).toHaveAttribute("data-state", "closed");
  });

  it("stays while the pointer rests on it", () => {
    vi.useFakeTimers();
    shownAt(110);
    fireEvent.pointerEnter(bar());
    act(() => vi.advanceTimersByTime(APP_ZOOM_INDICATOR_MS * 3));
    expect(bar()).toHaveAttribute("data-state", "open");

    fireEvent.pointerLeave(bar());
    act(() => vi.advanceTimersByTime(APP_ZOOM_INDICATOR_MS));
    expect(bar()).toHaveAttribute("data-state", "closed");
  });

  it("stays while keyboard focus is inside it, moving between its buttons included", () => {
    vi.useFakeTimers();
    shownAt(110);
    const zoomIn = button(commands.zoomIn.label);
    const zoomOut = button(commands.zoomOut.label);
    act(() => zoomOut.focus());
    act(() => zoomIn.focus());
    act(() => vi.advanceTimersByTime(APP_ZOOM_INDICATOR_MS * 3));
    expect(bar()).toHaveAttribute("data-state", "open");

    act(() => zoomIn.blur());
    act(() => vi.advanceTimersByTime(APP_ZOOM_INDICATOR_MS));
    expect(bar()).toHaveAttribute("data-state", "closed");
  });

  it("leaves focus where it was when a button is pressed", () => {
    shownAt(110);
    expect(fireEvent.mouseDown(button(commands.zoomIn.label))).toBe(false);
  });
});
