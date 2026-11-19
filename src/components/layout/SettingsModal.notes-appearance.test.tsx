// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocale } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  libraryRoot: vi.fn(() => Promise.resolve("/tmp/library")),
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

import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { SettingsModal } from "./SettingsModal";

const notes = enNotes.appearance.notes;
const SLOW_RUNNER_MS = 20_000;
const SLOW_RUNNER_WAIT = { timeout: 10_000 };

beforeAll(async () => {
  useSettingsStore.setState({ notes: true, settingsInitialAppearanceTab: "notes" });
  const warmUp = render(<AppearanceSection />);
  await screen.findByTestId("settings-appearance-notes", {}, { timeout: SLOW_RUNNER_MS });
  warmUp.unmount();
  useSettingsStore.setState({ notes: false });
}, 2 * SLOW_RUNNER_MS);

function navigation() {
  return screen.getByRole("navigation", { name: enShell.settings.sectionsNav });
}

function search(value: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: enShell.settings.search.label }), { target: { value } });
}

describe("Notes appearance in Settings search", { timeout: SLOW_RUNNER_MS }, () => {
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
    fireEvent.click(await within(navigation()).findByRole("button", { name: notes.callouts.label }, SLOW_RUNNER_WAIT));
    await waitFor(
      () => expect(screen.getByTestId("appearance-tab-notes")).toHaveAttribute("aria-selected", "true"),
      SLOW_RUNNER_WAIT,
    );
    const row = await screen.findByTestId("settings-row-notes-callouts", {}, SLOW_RUNNER_WAIT);
    await waitFor(() => expect(row).toHaveAttribute("data-settings-search-hit"), SLOW_RUNNER_WAIT);
  });

  it("does not offer Notes rows while Notes is off", async () => {
    render(<SettingsModal />);
    search("callout style");
    await waitFor(() => expect(screen.queryByTestId("settings-section-general")).toBeNull(), SLOW_RUNNER_WAIT);
    expect(screen.queryByTestId("settings-section-appearance")).toBeNull();
    expect(within(navigation()).queryByRole("button", { name: notes.callouts.label })).toBeNull();
  });
});

const SETTINGS_WIDTH = "w-[min(1180px,94vw)]";

function settingsDialog() {
  return screen.getByRole("dialog", { name: enShell.settings.title });
}

describe("Settings size", { timeout: SLOW_RUNNER_MS }, () => {
  beforeEach(async () => {
    await applyLocale("en");
    useTourStore.setState({ activeTourId: null });
    Element.prototype.scrollIntoView = vi.fn();
    useSettingsStore.setState({ notes: true });
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("appearance");
    settings.setSettingsOpen(true);
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.getState().setSettingsOpen(false);
    useSettingsStore.setState({ notes: false });
  });

  it("keeps one size on every section and tab, the Notes preview included", async () => {
    render(<SettingsModal />);
    const dialog = settingsDialog();
    const sized = () => {
      expect(settingsDialog()).toBe(dialog);
      expect(dialog).toHaveClass(SETTINGS_WIDTH, "h-(--settings-height)");
      expect(dialog.className).not.toMatch(/transition-\[width\]|1040px|1380px/u);
    };
    sized();

    fireEvent.mouseDown(screen.getByTestId("appearance-tab-notes"));
    await screen.findByTestId("settings-appearance-notes-layout", {}, SLOW_RUNNER_WAIT);
    sized();

    fireEvent.mouseDown(screen.getByTestId("appearance-tab-editor"));
    await waitFor(() => expect(screen.queryByTestId("settings-appearance-notes-layout")).toBeNull(), SLOW_RUNNER_WAIT);
    sized();

    fireEvent.click(screen.getByTestId("settings-section-general"));
    await waitFor(
      () => expect(screen.getByTestId("settings-section-general")).toHaveAttribute("aria-current", "page"),
      SLOW_RUNNER_WAIT,
    );
    sized();
  });
});
