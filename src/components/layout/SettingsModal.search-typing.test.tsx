// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocale } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const engineRenders = vi.fn();
vi.mock("@/components/settings/EngineSection", () => ({ EngineSection: () => { engineRenders(); return <div data-testid="engine-section" />; } }));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(async () => undefined) }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  libraryRoot: vi.fn(async () => "/tmp/library"),

setActiveProject: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@/i18n/desktop", () => ({ changeLocalePreference: vi.fn(async () => {}) }));
vi.mock("@/components/layout/UpdateChecker", () => ({ UpdateChecker: () => null }));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ preference: "dark", theme: "dark", setPreference: vi.fn(), toggleTheme: vi.fn() }),
}));

import { SettingsModal } from "./SettingsModal";

function searchField() {
  return screen.getByRole("searchbox", { name: enShell.settings.search.label });
}

describe("Settings search while typing", () => {
  beforeEach(async () => {
    await applyLocale("en");
    engineRenders.mockClear();
    useTourStore.setState({ activeTourId: null });
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("engine");
    settings.setSettingsOpen(true);
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.getState().setSettingsOpen(false);
  });

  it("does not re-render the open section for every key, only once the query settles", async () => {
    render(<SettingsModal />);
    await screen.findByTestId("engine-section");
    fireEvent.change(searchField(), { target: { value: "a" } });
    const afterFirstKey = engineRenders.mock.calls.length;

    for (const value of ["en", "eng", "engi", "engine"]) {
      fireEvent.change(searchField(), { target: { value } });
    }
    expect(searchField()).toHaveValue("engine");
    expect(engineRenders.mock.calls).toHaveLength(afterFirstKey);

    await waitFor(() =>
      expect(screen.getByTestId("settings-section-engine")).toHaveAttribute("aria-current", "page"),
    );
    await waitFor(() => expect(engineRenders.mock.calls.length).toBeGreaterThan(afterFirstKey));
  });
});
