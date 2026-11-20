// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocale } from "@/i18n";
import { useResearchTasksFlagStore } from "@/store/research-tasks-flag";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";

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

import { SettingsModal } from "./SettingsModal";

const SLOW_RUNNER_WAIT = { timeout: 10_000 };

function current(section: string) {
  return waitFor(
    () => expect(screen.getByTestId(`settings-section-${section}`)).toHaveAttribute("aria-current", "page"),
    SLOW_RUNNER_WAIT,
  );
}

function selectedTab(id: string) {
  return waitFor(() => expect(screen.getByTestId(id)).toHaveAttribute("aria-selected", "true"), SLOW_RUNNER_WAIT);
}

function closeWithButton() {
  fireEvent.click(screen.getByTestId("settings-close"));
  expect(useSettingsStore.getState().settingsOpen).toBe(false);
}

function openPlainly() {
  act(() => useSettingsStore.getState().setSettingsOpen(true));
}

describe("Settings reopens where the person left it", { timeout: 20_000 }, () => {
  beforeEach(async () => {
    await applyLocale("en");
    useTourStore.setState({ activeTourId: null });
    useResearchTasksFlagStore.setState({ enabled: false });
    Element.prototype.scrollIntoView = vi.fn();
    useSettingsStore.setState({
      settingsOpen: true,
      settingsInitialSection: null,
      settingsInitialAppearanceTab: null,
      settingsLastSection: "general",
      settingsLastTabs: {},
    });
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.getState().setSettingsOpen(false);
  });

  it("opens on General the first time and on the last section after that", async () => {
    render(<SettingsModal />);
    await current("general");
    fireEvent.click(screen.getByTestId("settings-section-shortcuts"));
    await current("shortcuts");

    closeWithButton();
    expect(useSettingsStore.getState().settingsInitialSection).toBeNull();
    openPlainly();

    await current("shortcuts");
  });

  it("keeps the last tab of the section it reopens on", async () => {
    render(<SettingsModal />);
    fireEvent.click(screen.getByTestId("settings-section-appearance"));
    fireEvent.mouseDown(await screen.findByTestId("appearance-tab-pdf", {}, SLOW_RUNNER_WAIT));
    await selectedTab("appearance-tab-pdf");

    closeWithButton();
    openPlainly();

    await current("appearance");
    await selectedTab("appearance-tab-pdf");
  });

  it("remembers the place when Settings closes from elsewhere and when it is mounted again", async () => {
    const first = render(<SettingsModal />);
    fireEvent.click(screen.getByTestId("settings-section-shortcuts"));
    await current("shortcuts");
    act(() => useSettingsStore.getState().setSettingsOpen(false));
    first.unmount();

    render(<SettingsModal />);
    openPlainly();

    await current("shortcuts");
  });

  it("lets a link to a section win, and starts that section on its own tab", async () => {
    render(<SettingsModal />);
    fireEvent.click(screen.getByTestId("settings-section-appearance"));
    fireEvent.mouseDown(await screen.findByTestId("appearance-tab-pdf", {}, SLOW_RUNNER_WAIT));
    await selectedTab("appearance-tab-pdf");
    fireEvent.click(screen.getByTestId("settings-section-shortcuts"));
    await current("shortcuts");
    closeWithButton();

    act(() => useSettingsStore.getState().openSettingsAt("appearance"));
    await current("appearance");
    await selectedTab("appearance-tab-app");
    closeWithButton();

    act(() => useSettingsStore.getState().openSettingsAt("appearance", "editor"));
    await current("appearance");
    await selectedTab("appearance-tab-editor");
    closeWithButton();

    openPlainly();
    await current("appearance");
    await selectedTab("appearance-tab-editor");
  });

  it("falls back to General when the remembered section is gone", async () => {
    useSettingsStore.setState({ settingsLastSection: "research" });
    render(<SettingsModal />);
    await current("general");
  });
});
