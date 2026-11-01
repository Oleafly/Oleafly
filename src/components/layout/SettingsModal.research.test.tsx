// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";

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
vi.mock("@/components/settings/research/ResearchSettingsSection", () => ({
  ResearchSettingsSection: () => <div data-testid="research-section-stub" />,
}));

const flag = await vi.hoisted(async () => {
  const { create } = await import("zustand");
  return { store: create<{ enabled: boolean }>(() => ({ enabled: false })), set: vi.fn() };
});
vi.mock("@/store/research-tasks-flag", () => ({
  useResearchTasksEnabled: () => flag.store((state) => state.enabled),
  useResearchTasksFlagStore: flag.store,
  setResearchTasksEnabled: (value: boolean) => flag.set(value),
}));

import { SettingsModal } from "./SettingsModal";

const experimentation = enShell.settings.experimentation;
const nav = enShell.settings.nav;

describe("Research tasks flag", () => {
  beforeEach(() => {
    localStorage.clear();
    flag.store.setState({ enabled: false });
    flag.set.mockReset().mockImplementation(async (value: boolean) => {
      flag.store.setState({ enabled: value });
    });
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("experimentation");
    settings.setSettingsOpen(true);
  });

  it("turns research tasks on from Experimentation, which adds the Research section", async () => {
    render(<SettingsModal />);
    const toggle = screen.getByRole("switch", { name: experimentation.researchTasks.label });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveTextContent("Highly unstable");
    expect(screen.queryByRole("button", { name: nav.research })).toBeNull();

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(flag.set).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.getByRole("button", { name: nav.research })).toBeInTheDocument();

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(screen.queryByRole("button", { name: nav.research })).toBeNull();
  });

  it("leaves the Research section and goes back to General when the switch goes off there", async () => {
    flag.store.setState({ enabled: true });
    useSettingsStore.getState().setSettingsInitialSection("research");
    render(<SettingsModal />);
    expect(await screen.findByTestId("research-section-stub")).toBeInTheDocument();

    act(() => flag.store.setState({ enabled: false }));

    await waitFor(() => expect(screen.queryByTestId("research-section-stub")).toBeNull());
    expect(screen.queryByRole("button", { name: nav.research })).toBeNull();
  });

  it("says so and keeps the switch where it was when Rust refuses", async () => {
    flag.set.mockRejectedValueOnce(new Error("Research tasks are off, but some running tasks could not be stopped"));
    render(<SettingsModal />);
    const toggle = screen.getByRole("switch", { name: experimentation.researchTasks.label });

    fireEvent.click(toggle);

    expect(await screen.findByRole("alert")).toHaveTextContent(experimentation.researchTasks.saveFailed);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});
