// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { i18n } from "@/i18n";
import { useSettingsStore } from "@/store/settings";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  appVersion: () => Promise.resolve("0.4.8"),
  libraryRoot: vi.fn(async () => "/tmp/library"),
}));
vi.mock("@/components/layout/UpdateChecker", () => ({ UpdateChecker: () => null }));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ preference: "dark", theme: "dark", setPreference: vi.fn(), toggleTheme: vi.fn() }),
}));
// The section itself reads the app config over IPC; it has its own tests.
vi.mock("@/components/settings/research/ResearchSettingsSection", () => ({
  ResearchSettingsSection: () => <div data-testid="research-settings-stub" />,
}));

import { SettingsModal } from "./SettingsModal";

describe("Settings, Research", () => {
  beforeEach(() => {
    localStorage.clear();
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("general");
    settings.setSettingsOpen(true);
  });

  it("lists Research after AI and loads the section with its strings", async () => {
    render(<SettingsModal />);
    const entry = screen.getByTestId("settings-section-research");
    expect(entry).toHaveTextContent(enShell.settings.nav.research);
    expect(screen.getByTestId("settings-section-ai").compareDocumentPosition(entry)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    fireEvent.click(entry);

    expect(await screen.findByTestId("research-settings-stub")).toBeInTheDocument();
    expect(entry).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 2, name: enShell.settings.nav.research })).toBeInTheDocument();
    expect(i18n.hasResourceBundle("en", "researchTools")).toBe(true);
  });

  it("opens straight on Research when asked", async () => {
    useSettingsStore.getState().setSettingsInitialSection("research");
    render(<SettingsModal />);

    expect(await screen.findByTestId("research-settings-stub")).toBeInTheDocument();
    expect(screen.getByTestId("settings-section-research")).toHaveAttribute("aria-current", "page");
  });
});
