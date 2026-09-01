// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
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
