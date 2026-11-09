// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings";

const imported = vi.hoisted(() => ({ collaboration: false }));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  appVersion: () => Promise.resolve("0.4.6"),
  libraryRoot: vi.fn(async () => "/tmp/library"),
}));
vi.mock("@/components/layout/UpdateChecker", () => ({ UpdateChecker: () => null }));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ preference: "dark", theme: "dark", setPreference: vi.fn(), toggleTheme: vi.fn() }),
}));
vi.mock("@/features/collab/CollaborationSection", () => {
  imported.collaboration = true;
  return { CollaborationSection: () => <div data-testid="collab-section-stub" /> };
});
vi.mock("@/components/settings/NotesAppearance", () => ({
  NotesAppearanceTab: () => <div data-testid="notes-appearance-stub" />,
}));

import { STARTUP_MS, startWarming, stopWarming } from "@/lib/preloadable";
import { SettingsModal } from "./SettingsModal";

afterEach(() => {
  stopWarming();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("warming the settings tabs", () => {
  it("loads the tabs ahead of time so Collaboration shows on the first click", async () => {
    useSettingsStore.setState({ notes: true });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("requestIdleCallback", (run: () => void) => setTimeout(run, 0));
    vi.stubGlobal("cancelIdleCallback", (id: number) => clearTimeout(id));
    startWarming(vi.fn());
    expect(imported.collaboration).toBe(false);
    await vi.advanceTimersByTimeAsync(STARTUP_MS);
    await waitFor(() => expect(imported.collaboration).toBe(true), { timeout: 20_000 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    stopWarming();
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("general");
    settings.setSettingsOpen(true);
    render(<SettingsModal />);
    act(() => {
      fireEvent.click(screen.getByTestId("settings-section-collaboration"));
    });
    expect(screen.getByTestId("collab-section-stub")).toBeInTheDocument();
  });
});
