// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@/features/collab/CollaborationSection", () => ({
  CollaborationSection: () => <div data-testid="collab-section-stub" />,
}));

import { SettingsModal } from "./SettingsModal";

const notesCopy = enShell.settings.experimentation.notes;
const initial = useSettingsStore.getState();

function notesSwitch() {
  return within(screen.getByTestId("settings-body")).getByRole("switch", { name: notesCopy.label });
}

describe("Notes switch in Experimentation", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ notes: false });
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("experimentation");
    settings.setSettingsOpen(true);
  });

  afterEach(() => {
    useSettingsStore.setState(initial, true);
    localStorage.clear();
  });

  it("explains what Notes adds and starts off", () => {
    render(<SettingsModal />);
    const toggle = notesSwitch();
    expect(toggle).toHaveAttribute("data-testid", "settings-notes");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(notesCopy.description)).toBeInTheDocument();
  });

  it("turns Notes on and off and remembers the choice", () => {
    render(<SettingsModal />);
    fireEvent.click(notesSwitch());
    expect(useSettingsStore.getState().notes).toBe(true);
    expect(localStorage.getItem("oleafly.notes")).toBe("1");
    expect(notesSwitch()).toHaveAttribute("aria-checked", "true");

    fireEvent.click(notesSwitch());
    expect(useSettingsStore.getState().notes).toBe(false);
    expect(localStorage.getItem("oleafly.notes")).toBe("0");
    expect(notesSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("shows Notes as on when it was turned on earlier", () => {
    useSettingsStore.setState({ notes: true });
    render(<SettingsModal />);
    expect(notesSwitch()).toHaveAttribute("aria-checked", "true");
  });
});
