// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useEditorKeymapStore } from "@/store/editor-keymap";
import { useSettingsStore } from "@/store/settings";
import { SETTING_DEFINITIONS, type SettingDefinition } from "@/store/settings-schema";
import { SETTING_ALTERNATES } from "@/store/settings-schema-fixture";
import { useShortcutStore } from "@/store/shortcuts";

const mocks = vi.hoisted(() => ({
  preference: "system" as "system" | "light" | "dark",
  setPreference: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  libraryRoot: vi.fn(async () => ""),
}));
vi.mock("@/i18n/desktop", () => ({ changeLocalePreference: vi.fn(async () => {}) }));
vi.mock("@/components/layout/UpdateChecker", () => ({ UpdateChecker: () => null }));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    preference: mocks.preference,
    theme: "dark",
    setPreference: mocks.setPreference,
    toggleTheme: vi.fn(),
  }),
}));

import { SettingsModal } from "./SettingsModal";

const mathPreview = enSettings.appearance.editor.mathPreview.label;
const fill = (template: string, label: string) => template.replace("{{label}}", label);

function openAt(section: string) {
  const settings = useSettingsStore.getState();
  settings.setSettingsInitialSection(section);
  settings.setSettingsOpen(true);
  render(<SettingsModal />);
}

function navItem(section: string) {
  return screen.getByTestId(`settings-section-${section}`);
}

describe("Settings changed markers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.preference = "system";
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    useSettingsStore.getState().resetToDefaults();
    useSettingsStore.getState().setSettingsScrollTarget(null);
    useSettingsStore.getState().setSettingsInitialAppearanceTab(null);
    useShortcutStore.getState().resetAll();
    useEditorKeymapStore.getState().resetAll();
  });

  it("shows no counts in the navigation at the defaults", () => {
    openAt("general");

    expect(navItem("appearance")).toHaveTextContent(/^Appearance$/u);
    expect(navItem("changed")).toHaveTextContent(new RegExp(`^${enShell.settings.nav.changed}$`, "u"));
  });

  it("counts changes per section and in total", () => {
    useSettingsStore.getState().setEditorMathPreview(false);
    useSettingsStore.getState().setEditorTheme("dracula");
    openAt("general");

    expect(navItem("appearance")).toHaveTextContent("2");
    expect(navItem("appearance")).toHaveAccessibleName(
      `${enShell.settings.nav.appearance} 2 changed`,
    );
    expect(navItem("changed")).toHaveTextContent("2");

    act(() => useSettingsStore.getState().setLatexTools(true));
    expect(navItem("experimentation")).toHaveTextContent("1");
    expect(navItem("changed")).toHaveTextContent("3");
  });

  it("lists every changed setting in the Changed settings view", () => {
    useSettingsStore.getState().setEditorMathPreview(false);
    openAt("general");

    fireEvent.click(navItem("changed"));

    expect(screen.getByRole("heading", { name: enShell.settings.nav.changed })).toBeInTheDocument();
    expect(screen.getByTestId("changed-setting-editorMathPreview")).toHaveTextContent(mathPreview);
  });

  it("jumps to the setting's control and highlights its row", async () => {
    useSettingsStore.getState().setEditorMathPreview(false);
    openAt("changed");

    fireEvent.click(screen.getByRole("button", { name: fill(enSettings.changed.showAriaLabel, mathPreview) }));

    expect(screen.getByRole("heading", { name: enShell.settings.nav.appearance })).toBeInTheDocument();
    expect(screen.getByTestId("appearance-tab-editor")).toHaveAttribute("aria-selected", "true");
    const row = document.querySelector<HTMLElement>('[data-setting-id="editorMathPreview"]');
    if (!row) throw new Error("math preview row is missing");
    await waitFor(() => expect(row).toHaveAttribute("data-setting-highlight"));
    expect(document.activeElement).toBe(within(row).getByRole("switch", { name: mathPreview }));
    expect(within(row).getByText(enSettings.changed.marker)).toBeInTheDocument();
    expect(useSettingsStore.getState().settingsScrollTarget).toBeNull();
  });

  it("reveals the grammar checking toggle for a changed dialect while its row is hidden", async () => {
    useSettingsStore.getState().setGrammarDialect("british");
    useSettingsStore.getState().setHarper(false);
    openAt("changed");
    const dialect = enShell.settings.general.dialect.label;

    fireEvent.click(screen.getByRole("button", { name: fill(enSettings.changed.showAriaLabel, dialect) }));

    expect(screen.getByRole("heading", { name: enShell.settings.nav.general })).toBeInTheDocument();
    const row = document.querySelector<HTMLElement>('[data-setting-id="harper"]');
    if (!row) throw new Error("grammar checking row is missing");
    await waitFor(() => expect(row).toHaveAttribute("data-setting-highlight"));
    expect(document.activeElement).toBe(
      within(row).getByRole("switch", { name: enShell.settings.general.harper.label }),
    );
  });

  it("clears the count after a reset from the list", () => {
    useSettingsStore.getState().setEditorMathPreview(false);
    openAt("changed");

    fireEvent.click(screen.getByRole("button", { name: fill(enSettings.changed.reset, mathPreview) }));

    expect(useSettingsStore.getState().editorMathPreview).toBe(true);
    expect(navItem("appearance")).toHaveTextContent(/^Appearance$/u);
    expect(screen.getByText(enSettings.changed.empty)).toBeInTheDocument();
  });

  it.each(SETTING_DEFINITIONS.map((definition) => [definition.id, definition] as const))(
    "shows %s at its own row",
    async (id, definition: SettingDefinition) => {
      // A fixed palette keeps the terminal color inputs enabled.
      if (definition.id.startsWith("terminal") && definition.kind === "color") {
        useSettingsStore.getState().setTerminalColorTheme("dracula");
      }
      definition.write(SETTING_ALTERNATES[id], {
        setThemePreference: (preference) => {
          mocks.preference = preference;
        },
      });
      openAt("changed");

      fireEvent.click(
        screen.getByRole("button", { name: fill(enSettings.changed.showAriaLabel, definition.label()) }),
      );

      await waitFor(() =>
        expect(document.querySelector(`[data-setting-id="${id}"]`)).toHaveAttribute(
          "data-setting-highlight",
        ),
      );
    },
  );
});
