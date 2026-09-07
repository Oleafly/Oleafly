// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTourStore } from "@/store/tours";
import { useSettingsStore } from "@/store/settings";
import { START_TOUR_EVENT } from "@/lib/tour";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { TourGuide } from "@/components/tour/TourGuide";

const mocks = vi.hoisted(() => ({
  libraryRoot: vi.fn(),
  setPreference: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  libraryRoot: mocks.libraryRoot,
}));
vi.mock("@/components/layout/UpdateChecker", () => ({
  UpdateChecker: () => null,
}));
// Starting this tour switches to the AI section. Its contents are irrelevant
// here and drag in Tauri IPC, so stand it down.
vi.mock("@/components/settings/AISection", () => ({
  AISection: () =>
    createElement("div", { "data-tour": "ai-settings-tabs" }, "AI settings tabs"),
}));
vi.mock("@/lib/confetti", () => ({ celebrate: vi.fn() }));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    preference: "dark",
    theme: "dark",
    setPreference: mocks.setPreference,
    toggleTheme: vi.fn(),
  }),
}));

import { SettingsModal } from "./SettingsModal";

function setSpellcheck(value: boolean) {
  if (useSettingsStore.getState().spellcheck !== value) {
    useSettingsStore.getState().toggleSpellcheck();
  }
}

function restoreTestDefaults() {
  const settings = useSettingsStore.getState();
  setSpellcheck(true);
  settings.setHarper(true);
  settings.setGrammarDialect("american");
  settings.setDictionaryLocale("en_US");
  settings.setShowRegionalism(true);
  settings.setShowWordChoice(true);
  settings.setOffline(false);
  settings.setAccentColor("#2563eb");
  settings.setEditorTheme("system");
  settings.setVisualEditor(false);
  settings.setLatexTools(false);
  settings.setDefaultLatexEngine("tectonic");
  settings.setSettingsOpen(true);
  settings.setSettingsInitialSection("general");
  useTourStore.getState().resetAll();
}

function renderSettings(withTour = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SettingsModal />
      {withTour ? <TourGuide /> : null}
    </QueryClientProvider>,
  );
}

describe("Launching a tour that never starts on its own", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    vi.clearAllMocks();
    localStorage.clear();
    mocks.libraryRoot.mockResolvedValue("");
    restoreTestDefaults();
  });

  it("offers a Start button for the AI settings walkthrough and asks for it by name", () => {
    const started = vi.fn();
    window.addEventListener(START_TOUR_EVENT, started);
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: /Enable tour guides/u }));
    const row = screen
      .getByText("AI Assistant settings")
      .closest("div")?.parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Start" }));

    expect(started).toHaveBeenCalledOnce();
    expect((started.mock.calls[0][0] as CustomEvent).detail).toBe("ai-settings");
    window.removeEventListener(START_TOUR_EVENT, started);
  });

  it("does not offer Start for a tour the coordinator starts by itself", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /Enable tour guides/u }));
    const row = screen
      .getByText("Home and project creation")
      .closest("div")?.parentElement as HTMLElement;
    expect(within(row).queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("actually puts the walkthrough on screen when Start is pressed", async () => {
    renderSettings(true);

    fireEvent.click(screen.getByRole("button", { name: /Enable tour guides/u }));
    const row = screen
      .getByText("AI Assistant settings")
      .closest("div")?.parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Start" }));

    await waitFor(() => expect(useTourStore.getState().activeTourId).toBe("ai-settings"));
  });
});
