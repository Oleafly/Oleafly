// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TOUR_STORAGE_KEY, useTourStore } from "@/store/tours";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  libraryRoot: vi.fn(),
  setTheme: vi.fn(),
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
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: mocks.setTheme,
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

describe("Settings section resets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.libraryRoot.mockResolvedValue("");
    restoreTestDefaults();
  });

  it("resets only General preferences after confirmation and preserves tour progress", async () => {
    const settings = useSettingsStore.getState();
    settings.toggleSpellcheck();
    settings.setHarper(false);
    settings.setGrammarDialect("british");
    settings.setDictionaryLocale("en_GB");
    settings.setShowRegionalism(false);
    settings.setShowWordChoice(false);
    settings.setOffline(true);

    settings.setAccentColor("#db2777");
    settings.setEditorTheme("dracula");
    settings.setVisualEditor(true);
    settings.setDefaultLatexEngine("latexmk");

    useTourStore.getState().complete("home");
    useTourStore.getState().dismiss("workspace");
    const tourEnabled = useTourStore.getState().enabled;
    const tourProgress = structuredClone(useTourStore.getState().tours);
    const persistedTourProgress = localStorage.getItem(TOUR_STORAGE_KEY);

    render(<SettingsModal />);

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

    const confirmation = screen.getByRole("alertdialog", {
      name: /Reset General settings/u,
    });
    expect(confirmation).toHaveTextContent(
      "Restore General preferences to their defaults.",
    );
    expect(useSettingsStore.getState()).toMatchObject({
      spellcheck: false,
      harper: false,
      grammarDialect: "british",
      dictionaryLocale: "en_GB",
      showRegionalism: false,
      showWordChoice: false,
      offline: true,
    });

    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Reset to defaults" }),
    );

    expect(useSettingsStore.getState()).toMatchObject({
      spellcheck: true,
      harper: true,
      grammarDialect: "american",
      dictionaryLocale: "en_US",
      showRegionalism: true,
      showWordChoice: true,
      offline: false,
      accentColor: "#db2777",
      editorTheme: "dracula",
      visualEditor: true,
      defaultLatexEngine: "latexmk",
    });
    expect(localStorage.getItem("oleafly.spellcheck")).toBe("1");
    expect(localStorage.getItem("oleafly.harper")).toBe("1");
    expect(localStorage.getItem("oleafly.harper.dialect")).toBe("american");
    expect(localStorage.getItem("oleafly.dictionary.locale")).toBe("en_US");
    expect(localStorage.getItem("oleafly.harper.regionalism")).toBe("1");
    expect(localStorage.getItem("oleafly.harper.wordchoice")).toBe("1");
    expect(localStorage.getItem("oleafly.accent")).toBe("#db2777");
    expect(localStorage.getItem("oleafly.editorTheme")).toBe("dracula");
    expect(localStorage.getItem("oleafly.visualEditor")).toBe("1");
    expect(localStorage.getItem("oleafly.defaultLatexEngine")).toBe("latexmk");
    expect(useTourStore.getState().enabled).toBe(tourEnabled);
    expect(useTourStore.getState().tours).toEqual(tourProgress);
    expect(localStorage.getItem(TOUR_STORAGE_KEY)).toBe(persistedTourProgress);
    expect(mocks.setTheme).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByRole("alertdialog", { name: /Reset General settings/u }),
      ).not.toBeInTheDocument(),
    );
  });

  it("resets only Experimentation preferences after confirmation", async () => {
    const settings = useSettingsStore.getState();
    settings.setVisualEditor(true);
    settings.setLatexTools(true);

    settings.setGrammarDialect("british");
    settings.setAccentColor("#db2777");
    settings.setEditorTheme("dracula");
    settings.setDefaultLatexEngine("latexmk");
    settings.setSettingsInitialSection("experimentation");

    render(<SettingsModal />);
    await screen.findByRole("heading", { name: "Experimentation" });

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

    const confirmation = screen.getByRole("alertdialog", {
      name: /Reset Experimentation settings/u,
    });
    expect(confirmation).toHaveTextContent(
      "Restore Experimentation preferences to their defaults.",
    );
    expect(useSettingsStore.getState()).toMatchObject({
      visualEditor: true,
      latexTools: true,
    });

    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Reset to defaults" }),
    );

    expect(useSettingsStore.getState()).toMatchObject({
      visualEditor: false,
      latexTools: false,
      grammarDialect: "british",
      accentColor: "#db2777",
      editorTheme: "dracula",
      defaultLatexEngine: "latexmk",
    });
    expect(localStorage.getItem("oleafly.visualEditor")).toBe("0");
    expect(localStorage.getItem("oleafly.latexTools")).toBe("0");
    expect(localStorage.getItem("oleafly.harper.dialect")).toBe("british");
    expect(localStorage.getItem("oleafly.accent")).toBe("#db2777");
    expect(localStorage.getItem("oleafly.editorTheme")).toBe("dracula");
    expect(localStorage.getItem("oleafly.defaultLatexEngine")).toBe("latexmk");
    expect(mocks.setTheme).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByRole("alertdialog", {
          name: /Reset Experimentation settings/u,
        }),
      ).not.toBeInTheDocument(),
    );
  });
});
