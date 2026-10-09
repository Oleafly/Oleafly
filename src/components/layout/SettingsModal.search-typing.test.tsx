// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocale } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const aiRenders = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(async () => undefined) }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  libraryRoot: vi.fn(async () => "/tmp/library"),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@/i18n/desktop", () => ({ changeLocalePreference: vi.fn(async () => {}) }));
vi.mock("@/components/layout/UpdateChecker", () => ({ UpdateChecker: () => null }));
vi.mock("@/components/settings/AISection", () => ({
  AISection: () => {
    aiRenders();
    return <div data-testid="ai-section" />;
  },
}));
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
    aiRenders.mockClear();
    useTourStore.setState({ activeTourId: null });
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("ai");
    settings.setSettingsOpen(true);
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.getState().setSettingsOpen(false);
  });

  it("does not re-render the open section for every key, only once the query settles", async () => {
    render(<SettingsModal />);
    await screen.findByTestId("ai-section");
    fireEvent.change(searchField(), { target: { value: "a" } });
    const afterFirstKey = aiRenders.mock.calls.length;

    for (const value of ["ag", "age", "agen", "agent"]) {
      fireEvent.change(searchField(), { target: { value } });
    }
    expect(searchField()).toHaveValue("agent");
    expect(aiRenders.mock.calls).toHaveLength(afterFirstKey);

    await waitFor(() =>
      expect(screen.getByTestId("settings-section-ai")).toHaveAttribute("aria-current", "page"),
    );
    await waitFor(() => expect(aiRenders.mock.calls.length).toBeGreaterThan(afterFirstKey));
  });
});
