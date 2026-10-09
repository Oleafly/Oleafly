// @vitest-environment jsdom

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    preference: "system",
    theme: "light",
    setPreference: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));
vi.mock("@/lib/tauri", () => ({
  detectBrowserCookieSources: vi.fn(async () => []),
  importBrowserCookies: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));

import { useFilesStore } from "@/store/files";
import { useSettingsStore, sectionDiffersFromDefaults } from "@/store/settings";
import { useShortcutStore } from "@/store/shortcuts";
import { useZenStore } from "@/store/zen";
import { AppearanceSection } from "./AppearanceSection";

const zen = enSettings.appearance.zen;
const actions = enSettings.shortcuts.actions;

function group() {
  return screen.getByRole("region", { name: zen.title });
}

beforeEach(() => {
  useZenStore.getState().end();
  useFilesStore.setState({ projectId: "p1" } as unknown as ReturnType<typeof useFilesStore.getState>);
  useShortcutStore.getState().resetAll();
  useSettingsStore.setState({
    zenFullScreen: true,
    zenShowPdfOnCompile: true,
    settingsOpen: true,
    settingsInitialAppearanceTab: "files",
    showTree: true,
    assistantOpen: true,
    viewMode: "split",
  });
});

describe("the Zen mode settings group", () => {
  it("sits on the Project tab with its two options and no way to turn Zen mode on", () => {
    render(<AppearanceSection />);
    expect(screen.getByTestId("appearance-tab-files")).toHaveAttribute("data-state", "active");
    const section = within(group());
    expect(section.getAllByRole("switch").map((row) => row.getAttribute("aria-label"))).toEqual([
      zen.fullScreen.label,
      zen.showPdf.label,
    ]);
    expect(section.queryByRole("button", { name: new RegExp(actions.toggleZenMode.label) })).toBeNull();
    expect(section.getByRole("switch", { name: zen.fullScreen.label })).toHaveAttribute("aria-checked", "true");
    expect(section.getByRole("switch", { name: zen.showPdf.label })).toHaveAttribute("aria-checked", "true");
  });

  it("changes each option on its own", async () => {
    render(<AppearanceSection />);
    const user = userEvent.setup();
    const section = within(group());
    await user.click(section.getByRole("switch", { name: zen.fullScreen.label }));
    expect(useSettingsStore.getState()).toMatchObject({ zenFullScreen: false, zenShowPdfOnCompile: true });
    await user.click(section.getByRole("switch", { name: zen.showPdf.label }));
    expect(useSettingsStore.getState()).toMatchObject({ zenFullScreen: false, zenShowPdfOnCompile: false });
    expect(localStorage.getItem("oleafly.zen.fullScreen")).toBe("0");
    expect(localStorage.getItem("oleafly.zen.showPdfOnCompile")).toBe("0");
    expect(useZenStore.getState().active).toBe(false);
  });

  it("counts the options as appearance settings that reset with the rest", () => {
    act(() => useSettingsStore.getState().setZenShowPdfOnCompile(false));
    expect(sectionDiffersFromDefaults("appearance", useSettingsStore.getState())).toBe(true);
    act(() => useSettingsStore.getState().resetAppearancePreferences());
    expect(useSettingsStore.getState()).toMatchObject({ zenFullScreen: true, zenShowPdfOnCompile: true });
    expect(sectionDiffersFromDefaults("appearance", useSettingsStore.getState())).toBe(false);
  });
});
