// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocale } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(async () => undefined) }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  libraryRoot: vi.fn(async () => "/tmp/library"),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@/i18n/desktop", () => ({ changeLocalePreference: vi.fn(async () => {}) }));
vi.mock("@/components/layout/UpdateChecker", () => ({ UpdateChecker: () => null }));
vi.mock("@/components/settings/AISection", () => ({ AISection: () => <div data-testid="ai-section" /> }));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ preference: "dark", theme: "dark", setPreference: vi.fn(), toggleTheme: vi.fn() }),
  currentTheme: () => "dark",
  subscribeTheme: () => () => undefined,
}));

import { SettingsModal } from "./SettingsModal";

const notes = enSettings.appearance.notes;

function navigation() {
  return screen.getByRole("navigation", { name: enShell.settings.sectionsNav });
}

function search(value: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: enShell.settings.search.label }), { target: { value } });
}

describe("Notes appearance in Settings search", () => {
  beforeEach(async () => {
    await applyLocale("en");
    useTourStore.setState({ activeTourId: null });
    Element.prototype.scrollIntoView = vi.fn();
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("general");
    settings.setSettingsOpen(true);
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.getState().setSettingsOpen(false);
    useSettingsStore.setState({ notes: false });
  });

  it("finds a Notes row, opens the Notes tab and tints the row", async () => {
    useSettingsStore.setState({ notes: true });
    render(<SettingsModal />);
    search("callout style");
    fireEvent.click(await within(navigation()).findByRole("button", { name: notes.callouts.label }));
    await waitFor(() => expect(screen.getByTestId("appearance-tab-notes")).toHaveAttribute("aria-selected", "true"));
    const row = await screen.findByTestId("settings-row-notes-callouts");
    await waitFor(() => expect(row).toHaveAttribute("data-settings-search-hit"));
  });

  it("does not offer Notes rows while Notes is off", async () => {
    render(<SettingsModal />);
    search("callout style");
    await waitFor(() => expect(screen.queryByTestId("settings-section-general")).toBeNull());
    expect(screen.queryByTestId("settings-section-appearance")).toBeNull();
    expect(within(navigation()).queryByRole("button", { name: notes.callouts.label })).toBeNull();
  });
});
