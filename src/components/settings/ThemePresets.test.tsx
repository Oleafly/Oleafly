// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { DEFAULT_THEME_PRESET, THEME_PRESET_STORAGE_KEYS } from "@/lib/theme-presets";
import { useSettingsStore } from "@/store/settings";
import { ThemePresetSetting } from "./ThemePresets";

const strings = enSettings.appearance.app.themePresets;

beforeEach(() => {
  useSettingsStore.setState({ appThemeLight: DEFAULT_THEME_PRESET, appThemeDark: DEFAULT_THEME_PRESET });
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("ThemePresetSetting", () => {
  it("lists a theme for light mode and one for dark mode with Oleafly chosen", () => {
    render(<ThemePresetSetting />);
    expect(screen.getByText(strings.label)).toBeInTheDocument();
    expect(screen.getByText(strings.description)).toBeInTheDocument();
    const light = screen.getByRole("radiogroup", { name: strings.light });
    const dark = screen.getByRole("radiogroup", { name: strings.dark });
    expect(within(light).getAllByRole("radio")).toHaveLength(7);
    expect(within(dark).getAllByRole("radio")).toHaveLength(11);
    expect(within(light).getByRole("radio", { name: "Oleafly" })).toHaveAttribute("aria-checked", "true");
    expect(within(dark).getByRole("radio", { name: "Darcula" })).toHaveAttribute("aria-checked", "false");
  });

  it("saves the pick for its own mode only", () => {
    render(<ThemePresetSetting />);
    const dark = screen.getByRole("radiogroup", { name: strings.dark });
    fireEvent.click(within(dark).getByRole("radio", { name: "One Dark Pro" }));
    expect(useSettingsStore.getState().appThemeDark).toBe("one-dark-pro");
    expect(useSettingsStore.getState().appThemeLight).toBe(DEFAULT_THEME_PRESET);
    expect(localStorage.getItem(THEME_PRESET_STORAGE_KEYS.dark)).toBe("one-dark-pro");
    expect(within(dark).getByRole("radio", { name: "One Dark Pro" })).toHaveAttribute("aria-checked", "true");

    const light = screen.getByRole("radiogroup", { name: strings.light });
    fireEvent.click(within(light).getByRole("radio", { name: "GitHub Light" }));
    expect(useSettingsStore.getState().appThemeLight).toBe("github-light");
    expect(localStorage.getItem(THEME_PRESET_STORAGE_KEYS.light)).toBe("github-light");
  });

  it("opens each row scrolled to its chosen theme", () => {
    useSettingsStore.setState({ appThemeDark: "darcula" });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(128);
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
      return [...(this.parentElement?.children ?? [])].indexOf(this) * 140;
    });
    render(<ThemePresetSetting />);
    expect(screen.getByRole("radiogroup", { name: strings.dark }).scrollLeft).toBe(10 * 140 - (300 - 128) / 2);
    expect(screen.getByRole("radiogroup", { name: strings.light }).scrollLeft).toBe(0);
  });
});
