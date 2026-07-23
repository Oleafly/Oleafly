import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";

vi.mock("@/store/deadlines", () => ({
  useDeadlinesStore: { getState: () => ({ openView: vi.fn(async () => {}) }) },
}));

vi.mock("@/lib/theme", () => ({
  useTheme: vi.fn(() => ({ theme: "light", toggleTheme: vi.fn() })),
}));

vi.mock("@/lib/use-fullscreen", () => ({
  useFullscreen: vi.fn(() => false),
}));

import { HomeDock } from "./HomeDock";

beforeEach(() => {
  useHomeViewStore.setState({ page: "library", deadlinesOpen: false, toolsOpen: false });
  useSettingsStore.setState({ dockPlacement: "left" });
});

describe("HomeDock", () => {
  it("renders all five actions", () => {
    render(<HomeDock />);
    expect(screen.getByTestId("new-project")).toBeInTheDocument();
    expect(screen.getByTestId("open-deadlines")).toBeInTheDocument();
    expect(screen.getByTestId("open-latex-tools")).toBeInTheDocument();
    expect(screen.getByTestId("toggle-theme")).toBeInTheDocument();
    expect(screen.getByTestId("open-settings")).toBeInTheDocument();
  });

  it("clicking Deadlines opens the deadlines modal", () => {
    render(<HomeDock />);
    fireEvent.click(screen.getByTestId("open-deadlines"));
    expect(useHomeViewStore.getState().deadlinesOpen).toBe(true);
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
});
