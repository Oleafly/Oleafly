// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocale } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import zhHansSettings from "@/i18n/locales/zh-Hans/settings.json" with { type: "json" };

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(async () => undefined) }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  libraryRoot: vi.fn(async () => "/tmp/library"),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@/i18n/desktop", () => ({ changeLocalePreference: vi.fn(async () => {}) }));
vi.mock("@/components/layout/UpdateChecker", () => ({ UpdateChecker: () => null }));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ preference: "dark", theme: "dark", setPreference: vi.fn(), toggleTheme: vi.fn() }),
}));

import { SettingsModal } from "./SettingsModal";

describe("Settings language picker", () => {
  beforeEach(async () => {
    await applyLocale("en");
    const settings = useSettingsStore.getState();
    settings.setUiLocalePreference("system");
    settings.setSettingsOpen(true);
    settings.setSettingsInitialSection("general");
  });

  it("renders the language row in the General section", () => {
    render(<SettingsModal />);
    expect(screen.getByTestId("settings-language")).toBeInTheDocument();
    expect(screen.getByText(enSettings.language.label)).toBeInTheDocument();
    expect(screen.getByText(enSettings.language.note)).toBeInTheDocument();
  });

  it("re-renders in the active language without a reload", async () => {
    render(<SettingsModal />);
    await applyLocale("zh-Hans");
    expect(await screen.findByText(zhHansSettings.language.label)).toBeInTheDocument();
    await applyLocale("en");
    expect(await screen.findByText(enSettings.language.label)).toBeInTheDocument();
  });
});
