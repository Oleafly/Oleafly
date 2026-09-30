// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { applyLocale } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { SETTINGS_SEARCH_SECTIONS } from "@/components/settings/settings-search";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(async () => undefined) }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  libraryRoot: vi.fn(async () => "/tmp/library"),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@/i18n/desktop", () => ({ changeLocalePreference: vi.fn(async () => {}) }));
vi.mock("@/components/layout/UpdateChecker", () => ({ UpdateChecker: () => null }));
// The AI section loads providers through Tauri; these tests only need to see it open.
vi.mock("@/components/settings/AISection", () => ({ AISection: () => <div data-testid="ai-section" /> }));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ preference: "dark", theme: "dark", setPreference: vi.fn(), toggleTheme: vi.fn() }),
}));

import { SettingsModal } from "./SettingsModal";

function renderSettings() {
  return render(<SettingsModal />);
}

const search = enShell.settings.search;

function searchField() {
  return screen.getByRole("searchbox", { name: search.label });
}

function visibleSections() {
  return screen
    .getAllByTestId(/^settings-section-/)
    .map((button) => button.dataset.testid)
    .filter((id) => id !== "settings-section-scroll");
}

function typeQuery(value: string) {
  fireEvent.change(searchField(), { target: { value } });
}

describe("Settings search", () => {
  beforeEach(async () => {
    await applyLocale("en");
    useTourStore.setState({ activeTourId: null });
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("general");
    settings.setSettingsOpen(true);
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.getState().setSettingsOpen(false);
    vi.unstubAllGlobals();
    vi.mocked(invoke).mockImplementation(async () => undefined);
  });

  function navigation() {
    return screen.getByRole("navigation", { name: enShell.settings.sectionsNav });
  }

  async function clickRow(query: string, label: string) {
    typeQuery(query);
    fireEvent.click(await within(navigation()).findByRole("button", { name: label }));
  }

  it("puts the cursor in the search field when Settings opens", async () => {
    renderSettings();
    await waitFor(() => expect(searchField()).toHaveFocus());
  });

  it("keeps only the sections that mention the query and opens the first one", async () => {
    renderSettings();
    typeQuery("zotero");
    await waitFor(() => expect(screen.queryByTestId("settings-section-engine")).toBeNull());
    expect(visibleSections()).toEqual(["settings-section-integrations"]);
    expect(screen.getByTestId("settings-section-integrations")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("1 section matches")).toBeInTheDocument();
  });

  it("finds a setting that lives in a section with a different name", async () => {
    renderSettings();
    typeQuery("spellcheck");
    await waitFor(() => expect(screen.queryByTestId("settings-section-appearance")).toBeNull());
    expect(visibleSections()).toEqual(["settings-section-general", "settings-section-dictionary"]);
    expect(screen.getByTestId("settings-section-general")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("switch", { name: "Spellcheck" })).toBeInTheDocument();
  });

  it("lists matching rows under their section and jumps to the row", async () => {
    renderSettings();
    typeQuery("font size");
    const nav = screen.getByRole("navigation", { name: enShell.settings.sectionsNav });
    const row = await within(nav).findByRole("button", { name: "Editor font size" });
    expect(visibleSections()).toEqual(["settings-section-appearance"]);
    fireEvent.click(row);
    const target = await waitFor(() => {
      const hit = document.querySelector("[data-settings-search-hit]");
      expect(hit).not.toBeNull();
      return hit as HTMLElement;
    });
    expect(target).toHaveTextContent("Editor font size");
    await waitFor(() => expect(target.contains(document.activeElement)).toBe(true));
  });

  it("opens the section whose title matches a short query", async () => {
    renderSettings();
    typeQuery("ai");
    await waitFor(() =>
      expect(screen.getByTestId("settings-section-ai")).toHaveAttribute("aria-current", "page"),
    );
    expect(visibleSections().length).toBeLessThan(11);
    expect(screen.getByTestId("ai-section")).toBeInTheDocument();
  });

  it("says so when nothing matches, through a live region that is there before the result", async () => {
    renderSettings();
    expect(screen.queryByTestId("settings-search-status")).toBeNull();
    typeQuery("qqqzzzxx");
    const live = screen.getByTestId("settings-search-status");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("");
    await waitFor(() => expect(live).toHaveTextContent(search.empty));
    expect(screen.getByTestId("settings-search-status")).toBe(live);
    expect(visibleSections()).toEqual([]);
    const shown = screen.getAllByText(search.empty).filter((element) => element !== live);
    expect(shown).toHaveLength(1);
    expect(shown[0]).not.toHaveAttribute("role");
    expect(shown[0]).toHaveAttribute("aria-hidden", "true");
  });

  it("opens the sub-tab a row lives on when its keys do not name it, and tints the row", async () => {
    renderSettings();
    await clickRow("pdf dark mode", "PDF dark mode");
    await waitFor(() =>
      expect(screen.getByTestId("appearance-tab-pdf")).toHaveAttribute("aria-selected", "true"),
    );
    const toggle = await screen.findByRole("switch", { name: "PDF dark mode" });
    await waitFor(() => expect(toggle).toHaveAttribute("data-settings-search-hit"));
    expect(screen.getByTestId("settings-section-appearance")).toHaveAttribute("aria-current", "page");
  });

  function pressTab(testId: string) {
    const tab = screen.getByTestId(testId);
    fireEvent.mouseDown(tab, { button: 0 });
    fireEvent.click(tab);
  }

  it("opens a section's default tab for a row on it when another tab is open", async () => {
    renderSettings();
    fireEvent.click(screen.getByTestId("settings-section-engine"));
    await screen.findByTestId("engines-tab-typst");
    pressTab("engines-tab-typst");
    await waitFor(() =>
      expect(screen.getByTestId("engines-tab-typst")).toHaveAttribute("aria-selected", "true"),
    );
    await clickRow("default compile engine", "Default compile engine");
    await waitFor(() =>
      expect(screen.getByTestId("engines-tab-latex")).toHaveAttribute("aria-selected", "true"),
    );
    const heading = await screen.findByRole("heading", { name: "Default compile engine" });
    await waitFor(() => expect(heading).toHaveAttribute("data-settings-search-hit"));
  });

  it("opens the Local tab for storage usage when Data is on the Cloud tab", async () => {
    renderSettings();
    fireEvent.click(screen.getByTestId("settings-section-data"));
    await screen.findByTestId("data-tab-cloud");
    pressTab("data-tab-cloud");
    await waitFor(() =>
      expect(screen.getByTestId("data-tab-cloud")).toHaveAttribute("aria-selected", "true"),
    );
    await clickRow("storage usage", "Storage usage");
    await waitFor(() =>
      expect(screen.getByTestId("data-tab-local")).toHaveAttribute("aria-selected", "true"),
    );
    const heading = await screen.findByRole("heading", { name: "Storage usage" });
    await waitFor(() => expect(heading).toHaveAttribute("data-settings-search-hit"));
  });

  it("does not pull the user back to a row's tab after they pick another one", async () => {
    renderSettings();
    // Corner radius sits inside a collapsed panel, so the reveal keeps looking.
    await clickRow("corner radius", "Corner radius");
    await waitFor(() =>
      expect(screen.getByTestId("appearance-tab-app")).toHaveAttribute("aria-selected", "true"),
    );
    pressTab("appearance-tab-editor");
    expect(screen.getByTestId("appearance-tab-editor")).toHaveAttribute("aria-selected", "true");
    // Several frames, well inside the window the reveal keeps looking for.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByTestId("appearance-tab-editor")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("appearance-tab-app")).toHaveAttribute("aria-selected", "false");
  });

  it("tints something visible for a row whose label is an invisible heading", async () => {
    renderSettings();
    fireEvent.click(screen.getByTestId("settings-section-shortcuts"));
    await screen.findByTestId("shortcuts-tab-editor");
    pressTab("shortcuts-tab-editor");
    await clickRow("application shortcuts", "Application shortcuts");
    await waitFor(() =>
      expect(screen.getByTestId("shortcuts-tab-application")).toHaveAttribute("aria-selected", "true"),
    );
    const target = await waitFor(() => {
      const hit = document.querySelector("[data-settings-search-hit]");
      expect(hit).not.toBeNull();
      return hit as HTMLElement;
    });
    expect(target.closest(".sr-only")).toBeNull();
    expect(target).toHaveTextContent("Application shortcuts");
  });

  it("keeps listing a row it cannot find on the page", async () => {
    renderSettings();
    await clickRow("corner radius", "Corner radius");
    // Longer than the reveal gives up after, so a dropped row would be gone by now.
    await new Promise((resolve) => setTimeout(resolve, 2300));
    expect(within(navigation()).getByRole("button", { name: "Corner radius" })).toBeInTheDocument();
    expect(screen.getByTestId("settings-section-appearance")).toHaveAttribute("aria-current", "page");
    expect(document.querySelector("[data-settings-search-hit]")).toBeNull();
  }, 10_000);

  it("waits for a row the backend fills in late, however fast frames come", async () => {
    // Frames every millisecond or so, faster than any display, so a retry
    // window counted in frames would run out long before the list arrives.
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 1),
    );
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command !== "list_font_components") return [];
      await new Promise((resolve) => setTimeout(resolve, 900));
      return [{ id: "lato", label: "Lato", description: "", installed: false, approx_bytes: 0 }];
    });
    renderSettings();
    await clickRow("lato", "Lato");
    const target = await waitFor(
      () => {
        const hit = document.querySelector("[data-settings-search-hit]");
        expect(hit).not.toBeNull();
        return hit as HTMLElement;
      },
      { timeout: 2500 },
    );
    expect(target).toHaveTextContent("Lato");
    expect(screen.getByTestId("downloads-tab-fonts")).toHaveAttribute("aria-selected", "true");
  }, 10_000);

  it("clears the query on the first Escape and closes Settings on the second", async () => {
    renderSettings();
    typeQuery("zotero");
    await waitFor(() => expect(visibleSections()).toEqual(["settings-section-integrations"]));
    fireEvent.keyDown(searchField(), { key: "Escape" });
    expect(searchField()).toHaveValue("");
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
    await waitFor(() => expect(visibleSections()).toContain("settings-section-engine"));
    fireEvent.keyDown(searchField(), { key: "Escape" });
    expect(useSettingsStore.getState().settingsOpen).toBe(false);
  });

  it("starts empty again after closing, so a deep link is not filtered away", async () => {
    renderSettings();
    typeQuery("zotero");
    await waitFor(() => expect(visibleSections()).toEqual(["settings-section-integrations"]));
    act(() => useSettingsStore.getState().setSettingsOpen(false));
    act(() => useSettingsStore.getState().openSettingsAt("engine"));
    expect(searchField()).toHaveValue("");
    await waitFor(() =>
      expect(screen.getByTestId("settings-section-engine")).toHaveAttribute("aria-current", "page"),
    );
    expect(visibleSections()).toContain("settings-section-appearance");
  });

  it("starts empty again after Settings closes without closeSettings and reopens on the same section", async () => {
    renderSettings();
    typeQuery("zotero");
    await waitFor(() => expect(visibleSections()).toEqual(["settings-section-integrations"]));
    act(() => useSettingsStore.getState().setSettingsOpen(false));
    expect(useSettingsStore.getState().settingsInitialSection).toBe("general");
    act(() => useSettingsStore.getState().setSettingsOpen(true));
    expect(searchField()).toHaveValue("");
    const everySection = SETTINGS_SEARCH_SECTIONS.filter((id) => id !== "developer").map(
      (id) => `settings-section-${id}`,
    );
    await waitFor(() => expect(visibleSections()).toEqual(expect.arrayContaining(everySection)));
    expect(screen.getByTestId("settings-section-engine")).toBeInTheDocument();
    expect(screen.getByTestId("settings-section-general")).toHaveAttribute("aria-current", "page");
  });

  it("shows every section while the Settings tour runs", async () => {
    renderSettings();
    typeQuery("zotero");
    await waitFor(() => expect(visibleSections()).toEqual(["settings-section-integrations"]));
    act(() => useTourStore.setState({ activeTourId: "settings" }));
    expect(searchField()).toHaveValue("");
    expect(visibleSections()).toContain("settings-section-appearance");
    expect(visibleSections()).toContain("settings-section-help");
  });
});
