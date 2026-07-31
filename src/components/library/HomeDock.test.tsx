// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";

vi.mock("@/lib/theme", () => ({
  useTheme: vi.fn(() => ({ theme: "light", toggleTheme: vi.fn() })),
}));

vi.mock("@/lib/use-fullscreen", () => ({
  useFullscreen: vi.fn(() => false),
}));

import { HomeDock } from "./HomeDock";

beforeEach(() => {
  useHomeViewStore.setState({ page: "library", toolsOpen: false });
  useSettingsStore.setState({ dockPlacement: "left", latexTools: true });
});

describe("HomeDock", () => {
  it("renders the dock actions including LaTeX tools when enabled", () => {
    render(<HomeDock />);
    expect(screen.getByTestId("new-project")).toBeInTheDocument();
    expect(screen.getByTestId("open-latex-tools")).toBeInTheDocument();
    expect(screen.getByTestId("toggle-theme")).toBeInTheDocument();
    expect(screen.getByTestId("open-settings")).toBeInTheDocument();
  });

  it("hides the LaTeX tools action when the experimental setting is off", () => {
    useSettingsStore.setState({ latexTools: false });
    render(<HomeDock />);
    expect(screen.queryByTestId("open-latex-tools")).not.toBeInTheDocument();
  });

  it("clicking Tools opens the tools modal", () => {
    render(<HomeDock />);
    fireEvent.click(screen.getByTestId("open-latex-tools"));
    expect(useHomeViewStore.getState().toolsOpen).toBe(true);
  });

  it("renders bottom orientation when dockPlacement is bottom", () => {
    useSettingsStore.setState({ dockPlacement: "bottom" });
    render(<HomeDock />);
    expect(screen.getByTestId("home-dock")).toHaveAttribute("data-placement", "bottom");
  });

  it("puts New project first in the dock", () => {
    render(<HomeDock />);
    const dock = screen.getByTestId("home-dock");
    const first = dock.querySelector("button[data-testid]");
    expect(first).toHaveAttribute("data-testid", "new-project");
  });
});
