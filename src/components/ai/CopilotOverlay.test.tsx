// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { CopilotOverlay } from "./CopilotOverlay";

vi.mock("@/components/ai/ChatCore", () => ({ ChatCore: () => null }));

const OVERLAY_RECT_KEY = "oleafly.ai.overlay.rect";

describe("CopilotOverlay width floor", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 900,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    localStorage.setItem(
      OVERLAY_RECT_KEY,
      JSON.stringify({ x: 24, y: 64, w: 320, h: 600 }),
    );
    useSettingsStore.setState({ chatFloating: true, appFontSize: 16 });
  });

  it("uses the active app font size when clamping its initial width", () => {
    useSettingsStore.setState({ appFontSize: 20 });

    render(<CopilotOverlay />);

    expect(screen.getByTestId("copilot-overlay")).toHaveStyle({ width: "600px" });
  });

  it("reclamps an open overlay when the app font size increases", async () => {
    render(<CopilotOverlay />);
    expect(screen.getByTestId("copilot-overlay")).toHaveStyle({ width: "480px" });

    act(() => useSettingsStore.setState({ appFontSize: 20 }));

    await waitFor(() =>
      expect(screen.getByTestId("copilot-overlay")).toHaveStyle({ width: "600px" }),
    );
  });
});

describe("CopilotOverlay placement", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    localStorage.removeItem(OVERLAY_RECT_KEY);
    useSettingsStore.setState({ chatFloating: true, appFontSize: 16 });
  });

  it("opens near the top right corner when no position was saved", () => {
    render(<CopilotOverlay />);

    expect(screen.getByTestId("copilot-overlay")).toHaveStyle({ left: "1064px", top: "64px", width: "512px", height: "720px" });
  });

  it("ignores a corrupt saved position", () => {
    localStorage.setItem(OVERLAY_RECT_KEY, "{not json");

    render(<CopilotOverlay />);

    expect(screen.getByTestId("copilot-overlay")).toHaveStyle({ top: "64px" });
  });

  it("moves with its title bar and remembers where it was dropped", () => {
    render(<CopilotOverlay />);
    const overlay = screen.getByTestId("copilot-overlay");

    fireEvent.pointerDown(screen.getByTestId("copilot-overlay-drag"), { clientX: 1100, clientY: 70 });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 900, clientY: 170 }));
      window.dispatchEvent(new MouseEvent("pointerup"));
    });

    expect(overlay).toHaveStyle({ left: "864px", top: "164px" });
    expect(JSON.parse(localStorage.getItem(OVERLAY_RECT_KEY) ?? "{}")).toMatchObject({ x: 864, y: 164 });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 10 }));
    });
    expect(overlay).toHaveStyle({ left: "864px" });
  });

  it("resizes from its corner and stays inside a shrinking window", () => {
    render(<CopilotOverlay />);
    const overlay = screen.getByTestId("copilot-overlay");

    fireEvent.pointerDown(screen.getByTestId("copilot-overlay-resize"), { clientX: 1576, clientY: 784 });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 1500, clientY: 900 }));
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    expect(overlay).toHaveStyle({ width: "480px", height: "836px" });

    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(overlay).toHaveStyle({ height: "700px", top: "0px" });
  });

  it("docks back into the sidebar", () => {
    render(<CopilotOverlay />);

    fireEvent.click(screen.getByTestId("copilot-overlay-dock"));

    expect(useSettingsStore.getState().chatFloating).toBe(false);
    expect(screen.queryByTestId("copilot-overlay")).toBeNull();
  });
});

