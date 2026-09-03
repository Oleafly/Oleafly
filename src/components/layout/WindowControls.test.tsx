// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appWindow = vi.hoisted(() => ({
  isMaximized: vi.fn(() => Promise.resolve(false)),
  onResized: vi.fn(() => Promise.resolve(() => {})),
  minimize: vi.fn(() => Promise.resolve()),
  toggleMaximize: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => appWindow,
}));

async function loadControls(isWindows: boolean) {
  vi.resetModules();
  vi.doMock("@/lib/utils", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/utils")>();
    return { ...actual, isWindows };
  });
  const mod = await import("./WindowControls");
  return mod.WindowControls;
}

beforeEach(() => {
  appWindow.isMaximized.mockResolvedValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.doUnmock("@/lib/utils");
});

describe("WindowControls", () => {
  it("stays out of the toolbar on platforms with a native title bar", async () => {
    const WindowControls = await loadControls(false);
    const { container } = render(<WindowControls />);
    expect(container).toBeEmptyDOMElement();
    expect(appWindow.onResized).not.toHaveBeenCalled();
  });

  it("renders minimize, maximize and close in the Windows order", async () => {
    const WindowControls = await loadControls(true);
    render(<WindowControls />);
    const labels = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual(["Minimize", "Maximize", "Close"]);
  });

  it("drives the native window from each button", async () => {
    const WindowControls = await loadControls(true);
    const user = userEvent.setup();
    render(<WindowControls />);

    await user.click(screen.getByLabelText("Minimize"));
    expect(appWindow.minimize).toHaveBeenCalledTimes(1);

    await user.click(screen.getByLabelText("Maximize"));
    expect(appWindow.toggleMaximize).toHaveBeenCalledTimes(1);

    await user.click(screen.getByLabelText("Close"));
    expect(appWindow.close).toHaveBeenCalledTimes(1);
  });

  it("offers Restore once the window reports itself maximized", async () => {
    appWindow.isMaximized.mockResolvedValue(true);
    const WindowControls = await loadControls(true);
    render(<WindowControls />);
    expect(await screen.findByLabelText("Restore")).toBeInTheDocument();
  });

  it("keeps every caption button at its full width", async () => {
    const WindowControls = await loadControls(true);
    render(<WindowControls />);
    const strip = screen.getByLabelText("Window controls");
    expect(strip.className).toContain("shrink-0");
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toContain("w-[46px]");
      expect(button.className).toContain("shrink-0");
    }
    for (const divider of strip.querySelectorAll("div")) {
      expect(divider.className).toContain("shrink-0");
    }
  });
});
