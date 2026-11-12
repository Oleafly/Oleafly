// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("@/components/settings/SettingsFileCard", () => ({ default: () => null }));
vi.mock("@/components/settings/cloud/CloudTab", () => ({ CloudTab: () => null }));
vi.mock("@/components/layout/ChangelogDialog", () => ({ ChangelogDialog: () => null }));
vi.mock("@/components/settings/ai/AcpAgentsTab", () => ({ AcpAgentsTab: () => null }));
vi.mock("@/components/settings/ai/ToolsTab", () => ({ ToolsTab: () => null }));
vi.mock("@/components/settings/desktop-apps/DesktopAppsSection", () => ({ default: () => null }));
vi.mock("@/components/library/TemplateImportDialog", () => ({ TemplateImportDialog: () => null }));

import {
  IDLE_FALLBACK_MS,
  preloadIntent,
  STARTUP_MS,
  startWarming,
  stopWarming,
  warmingQueueLength,
} from "@/lib/preloadable";
import { SettingsModal } from "./SettingsModal";

afterEach(() => {
  stopWarming();
  vi.useRealTimers();
});

const realTimeout = globalThis.setTimeout;

async function idle(slots: number) {
  for (let slot = 0; slot < slots; slot++) {
    await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS);
    await new Promise((resolve) => realTimeout(resolve, 5));
  }
}

describe("warming the settings tabs", () => {
  it("waits for Settings to be opened or hovered, then loads the tabs so Collaboration shows on the first click", async () => {
    vi.useFakeTimers();
    startWarming(vi.fn());
    await vi.advanceTimersByTimeAsync(STARTUP_MS);
    await idle(15);
    expect(imported.collaboration).toBe(false);
    const waiting = warmingQueueLength();
    preloadIntent("settings");
    await idle(waiting + 2);
    expect(imported.collaboration).toBe(true);
    stopWarming();
    vi.useRealTimers();
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("general");
    settings.setSettingsOpen(true);
    render(<SettingsModal />);
    act(() => {
      fireEvent.click(screen.getByTestId("settings-section-collaboration"));
    });
    expect(screen.getByTestId("collab-section-stub")).toBeInTheDocument();
  }, 20_000);
});
