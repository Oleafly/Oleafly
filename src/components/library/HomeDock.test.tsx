// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";

const themeMocks = vi.hoisted(() => ({
  preference: "system" as "system" | "light" | "dark",
  setPreference: vi.fn(),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    preference: themeMocks.preference,
    theme: "light",
    setPreference: themeMocks.setPreference,
    toggleTheme: vi.fn(),
  }),
}));

vi.mock("@/lib/use-fullscreen", () => ({
  useFullscreen: vi.fn(() => false),
}));

import { HomeDock } from "./HomeDock";

beforeEach(() => {
  themeMocks.preference = "system";
  themeMocks.setPreference.mockClear();
  useHomeViewStore.setState({ page: "library", toolsOpen: false });
  useSettingsStore.setState({ dockPlacement: "left", latexTools: true });
});

function openThemeMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

describe("HomeDock", () => {
  it("renders the dock actions including LaTeX tools when enabled", () => {
    render(<HomeDock />);
    expect(screen.getByTestId("new-project")).toBeInTheDocument();
    expect(screen.getByTestId("open-latex-tools")).toBeInTheDocument();
    expect(screen.getByTestId("home-theme-menu")).toBeInTheDocument();
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

  it("names the current appearance on the theme menu and styles it like its neighbours", () => {
    themeMocks.preference = "dark";
    render(<HomeDock />);
    const trigger = screen.getByTestId("home-theme-menu");
    const settings = screen.getByTestId("open-settings");
    expect(trigger).toHaveAttribute("aria-label", "Appearance: Dark");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger.className).toContain("rounded-full");
    expect(trigger.className).toContain("hover:scale-[1.2]");
    expect(trigger.className).toContain("h-9");
    expect(settings.className).toContain("rounded-full");
  });

  it("opens the dock theme menu from a click that sends no pointer events", () => {
    render(<HomeDock />);
    const trigger = screen.getByTestId("home-theme-menu");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
  });

  it("offers system, light, and dark from the dock menu and applies the choice", () => {
    render(<HomeDock />);
    openThemeMenu(screen.getByTestId("home-theme-menu"));

    const options = screen.getAllByRole("menuitemradio");
    expect(options.map((option) => option.textContent)).toEqual(["System", "Light", "Dark"]);
    expect(screen.getByTestId("theme-option-system")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("theme-option-dark")).toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByTestId("theme-option-dark"));
    expect(themeMocks.setPreference).toHaveBeenCalledWith("dark");
    expect(screen.getByTestId("home-theme-menu")).toHaveAttribute("aria-expanded", "false");
  });
});
