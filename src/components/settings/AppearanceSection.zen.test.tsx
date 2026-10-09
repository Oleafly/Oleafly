// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";
import { useZenStore } from "@/store/zen";
import { AppearanceSection } from "./AppearanceSection";

const zen = enSettings.appearance.zen;
const shortcuts = enSettings.shortcuts.application;
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
    zenCenterEditor: true,
    zenShowPdfOnCompile: true,
    settingsOpen: true,
    settingsInitialAppearanceTab: "files",
    showTree: true,
    assistantOpen: true,
    viewMode: "split",
  });
});

describe("the Zen mode settings group", () => {
  it("sits on the Project tab with a switch, the shortcut and the three options", () => {
    render(<AppearanceSection />);
    expect(screen.getByTestId("appearance-tab-files")).toHaveAttribute("data-state", "active");
    const section = within(group());
    const toggle = section.getByRole("switch", { name: zen.toggle.label });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveTextContent(zen.toggle.description);
    const shortcut = shortcutLabel(useShortcutStore.getState().bindings.toggleZenMode);
    expect(
      section.getByRole("button", {
        name: shortcuts.editAriaLabel.replace("{{action}}", actions.toggleZenMode.label).replace("{{shortcut}}", shortcut),
      }),
    ).toBeVisible();
    expect(section.getByRole("switch", { name: zen.fullScreen.label })).toHaveAttribute("aria-checked", "true");
    expect(section.getByRole("switch", { name: zen.centerEditor.label })).toHaveAttribute("aria-checked", "true");
    expect(section.getByRole("switch", { name: zen.showPdf.label })).toHaveAttribute("aria-checked", "true");
  });

  it("rebinds the Zen mode shortcut right there", async () => {
    render(<AppearanceSection />);
    const user = userEvent.setup();
    const row = within(screen.getByTestId("settings-row-zen-shortcut"));
    const shortcut = shortcutLabel(useShortcutStore.getState().bindings.toggleZenMode);
    await user.click(
      row.getByRole("button", {
        name: shortcuts.editAriaLabel.replace("{{action}}", actions.toggleZenMode.label).replace("{{shortcut}}", shortcut),
      }),
    );
    const recorder = row.getByRole("button", {
      name: shortcuts.recordAriaLabel.replace("{{action}}", actions.toggleZenMode.label),
    });
    fireEvent.keyDown(recorder, { key: "z", ctrlKey: true, altKey: true });
    expect(useShortcutStore.getState().bindings.toggleZenMode).toMatchObject({ key: "z", mod: true, alt: true });
    expect(screen.getByTestId("settings-row-zen-shortcut")).toHaveTextContent(/Ctrl.*Alt.*Z/);
  });

  it("turns Zen mode on from the switch and closes Settings so it can be seen", async () => {
    render(<AppearanceSection />);
    await userEvent.setup().click(within(group()).getByRole("switch", { name: zen.toggle.label }));
    expect(useZenStore.getState().active).toBe(true);
    expect(useSettingsStore.getState().settingsOpen).toBe(false);
    expect(useSettingsStore.getState().showTree).toBe(false);
  });

  it("shows Zen mode as on and turns it off from the same switch", async () => {
    render(<AppearanceSection />);
    const toggle = within(group()).getByRole("switch", { name: zen.toggle.label });
    await userEvent.setup().click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.setup().click(toggle);
    expect(useZenStore.getState().active).toBe(false);
    expect(useSettingsStore.getState().showTree).toBe(true);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("leaves the switch idle when no project is open", async () => {
    useFilesStore.setState({ projectId: null } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<AppearanceSection />);
    const toggle = within(group()).getByRole("switch", { name: zen.toggle.label });
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    await userEvent.setup().click(toggle);
    expect(useZenStore.getState().active).toBe(false);
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
  });

  it("changes each option on its own", async () => {
    render(<AppearanceSection />);
    const user = userEvent.setup();
    const section = within(group());
    await user.click(section.getByRole("switch", { name: zen.fullScreen.label }));
    expect(useSettingsStore.getState()).toMatchObject({
      zenFullScreen: false,
      zenCenterEditor: true,
      zenShowPdfOnCompile: true,
    });
    await user.click(section.getByRole("switch", { name: zen.centerEditor.label }));
    await user.click(section.getByRole("switch", { name: zen.showPdf.label }));
    expect(useSettingsStore.getState()).toMatchObject({
      zenFullScreen: false,
      zenCenterEditor: false,
      zenShowPdfOnCompile: false,
    });
    expect(localStorage.getItem("oleafly.zen.fullScreen")).toBe("0");
    expect(localStorage.getItem("oleafly.zen.centerEditor")).toBe("0");
    expect(localStorage.getItem("oleafly.zen.showPdfOnCompile")).toBe("0");
  });

  it("counts the options as appearance settings that reset with the rest", () => {
    act(() => useSettingsStore.getState().setZenCenterEditor(false));
    expect(sectionDiffersFromDefaults("appearance", useSettingsStore.getState())).toBe(true);
    act(() => useSettingsStore.getState().resetAppearancePreferences());
    expect(useSettingsStore.getState()).toMatchObject({
      zenFullScreen: true,
      zenCenterEditor: true,
      zenShowPdfOnCompile: true,
    });
    expect(sectionDiffersFromDefaults("appearance", useSettingsStore.getState())).toBe(false);
  });
});
