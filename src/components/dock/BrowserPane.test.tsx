// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openBrowserWindow = vi.hoisted(() => vi.fn(async () => true));
const focusBrowserWindow = vi.hoisted(() => vi.fn(async () => true));
const closeBrowserWindow = vi.hoisted(() => vi.fn(async () => {}));
const openExternal = vi.hoisted(() => vi.fn(async () => {}));
const registerCuaSurface = vi.hoisted(() => vi.fn());

vi.mock("@/lib/browser-window", () => ({
  openBrowserWindow,
  focusBrowserWindow,
  closeBrowserWindow,
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: openExternal }));
vi.mock("@/lib/cua-sandbox", () => ({ registerCuaSurface }));

import { BROWSER_SEARCH_ENGINES, useSettingsStore } from "@/store/settings";
import { BrowserPane } from "./BrowserPane";

// The CUA mock records the last-registered surface so the navigate path can be
// exercised directly.
let lastSurface: unknown = null;
registerCuaSurface.mockImplementation((surface: unknown) => {
  if (surface) lastSurface = surface;
});

beforeEach(() => {
  openBrowserWindow.mockClear();
  focusBrowserWindow.mockClear();
  closeBrowserWindow.mockClear();
  openExternal.mockClear();
  lastSurface = null;
  useSettingsStore.setState({ browserSearchEngine: "google", browserHomePage: "" });
});

afterEach(() => {
  useSettingsStore.setState({ browserHomePage: "" });
});

describe("BrowserPane launcher", () => {
  it("opens a normalized plain address in a separate window", () => {
    render(<BrowserPane />);
    fireEvent.change(screen.getByLabelText("Browser address"), {
      target: { value: "arxiv.org/abs/2401.00001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(openBrowserWindow).toHaveBeenCalledWith("https://arxiv.org/abs/2401.00001");
  });

  it.each(["Enter", "Open"] as const)(
    "searches plain text with the configured engine using %s",
    (trigger) => {
      useSettingsStore.setState({ browserSearchEngine: "duckduckgo" });
      render(<BrowserPane />);
      const input = screen.getByLabelText("Browser address");
      fireEvent.change(input, { target: { value: "tauri child webview z order" } });
      if (trigger === "Enter") fireEvent.keyDown(input, { key: "Enter" });
      else fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(openBrowserWindow).toHaveBeenCalledWith(
        "https://duckduckgo.com/?q=tauri%20child%20webview%20z%20order",
      );
    },
  );

  it.each(BROWSER_SEARCH_ENGINES)(
    "uses the $name search URL from the engine catalog",
    ({ id, searchUrl }) => {
      useSettingsStore.setState({ browserSearchEngine: id });
      render(<BrowserPane />);
      fireEvent.change(screen.getByLabelText("Browser address"), {
        target: { value: "privacy research" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(openBrowserWindow).toHaveBeenCalledWith(
        `${searchUrl}${encodeURIComponent("privacy research")}`,
      );
    },
  );

  it("shows the current page and can focus the window or open it externally", () => {
    render(<BrowserPane />);
    fireEvent.change(screen.getByLabelText("Browser address"), {
      target: { value: "https://example.com/paper" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByTestId("dock-browser-current")).toHaveTextContent(
      "https://example.com/paper",
    );
    fireEvent.click(screen.getByTestId("dock-browser-focus"));
    expect(focusBrowserWindow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Open in system browser"));
    expect(openExternal).toHaveBeenCalledWith("https://example.com/paper");
  });

  it("registers a CUA surface whose navigate opens the browser window", () => {
    render(<BrowserPane />);
    const surface = lastSurface as { navigate: (u: string) => void; url: () => string };
    expect(surface).toBeTruthy();
    surface.navigate("https://example.org/from-agent");
    expect(openBrowserWindow).toHaveBeenCalledWith("https://example.org/from-agent");
    expect(surface.url()).toBe("https://example.org/from-agent");
  });

  it("closes the launched window when the dock is hidden", () => {
    const view = render(<BrowserPane visible />);
    view.rerender(<BrowserPane visible={false} />);
    expect(closeBrowserWindow).toHaveBeenCalled();
  });

  it("prefills the configured home page without opening a window", () => {
    useSettingsStore.setState({ browserHomePage: "https://example.com/home" });
    render(<BrowserPane />);
    expect(screen.getByLabelText("Browser address")).toHaveValue("https://example.com/home");
    expect(openBrowserWindow).not.toHaveBeenCalled();
  });
});
