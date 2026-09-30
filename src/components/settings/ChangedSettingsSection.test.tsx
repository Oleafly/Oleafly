// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useEditorKeymapStore } from "@/store/editor-keymap";
import { useSettingsStore } from "@/store/settings";
import { useShortcutStore } from "@/store/shortcuts";
import { ChangedSettingsProvider } from "./changed-settings";
import { ChangedSettingsSection } from "./ChangedSettingsSection";

const themeMocks = vi.hoisted(() => ({
  preference: "system" as "system" | "light" | "dark",
  setPreference: vi.fn(),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    preference: themeMocks.preference,
    theme: "dark",
    setPreference: themeMocks.setPreference,
    toggleTheme: vi.fn(),
  }),
}));

const changed = enSettings.changed;
const mathPreview = enSettings.appearance.editor.mathPreview.label;
const fill = (template: string, label: string) => template.replace("{{label}}", label);

function renderSection(onShow = vi.fn()) {
  render(
    <ChangedSettingsProvider>
      <ChangedSettingsSection onShow={onShow} />
    </ChangedSettingsProvider>,
  );
  return onShow;
}

describe("ChangedSettingsSection", () => {
  beforeEach(() => {
    localStorage.clear();
    themeMocks.preference = "system";
    themeMocks.setPreference.mockClear();
    useSettingsStore.getState().resetToDefaults();
    useShortcutStore.getState().resetAll();
    useEditorKeymapStore.getState().resetAll();
  });

  it("says so when every setting uses its default", () => {
    renderSection();

    expect(screen.getByText(changed.empty)).toBeInTheDocument();
    expect(screen.queryByText(changed.intro)).not.toBeInTheDocument();
  });

  it("groups changed settings by section and shows each current value", () => {
    useSettingsStore.getState().setEditorMathPreview(false);
    useSettingsStore.getState().setEditorTheme("dracula");
    useSettingsStore.getState().setLatexTools(true);
    renderSection();

    expect(screen.getByText(changed.intro)).toBeInTheDocument();
    const appearance = screen.getByRole("region", { name: enShell.settings.nav.appearance });
    expect(within(appearance).getByTestId("changed-setting-editorMathPreview")).toHaveTextContent(
      `${mathPreview}Off`,
    );
    expect(within(appearance).getByTestId("changed-setting-editorTheme")).toHaveTextContent(
      "Dracula",
    );
    const experimentation = screen.getByRole("region", {
      name: enShell.settings.nav.experimentation,
    });
    expect(within(experimentation).getByTestId("changed-setting-latexTools")).toHaveTextContent(
      "On",
    );
    expect(
      screen.queryByRole("region", { name: enShell.settings.nav.general }),
    ).not.toBeInTheDocument();
  });

  it("jumps to a setting's control", () => {
    useSettingsStore.getState().setEditorMathPreview(false);
    const onShow = renderSection();

    fireEvent.click(screen.getByRole("button", { name: fill(changed.showAriaLabel, mathPreview) }));

    expect(onShow).toHaveBeenCalledWith("editorMathPreview");
  });

  it("resets one setting and drops it from the list", () => {
    useSettingsStore.getState().setEditorMathPreview(false);
    useSettingsStore.getState().setLatexTools(true);
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: fill(changed.reset, mathPreview) }));

    expect(useSettingsStore.getState().editorMathPreview).toBe(true);
    expect(localStorage.getItem("oleafly.editor.mathPreview")).toBe("1");
    expect(screen.queryByTestId("changed-setting-editorMathPreview")).not.toBeInTheDocument();
    expect(screen.getByTestId("changed-setting-latexTools")).toBeInTheDocument();
  });

  it("moves keyboard focus to the next row's Show button after a reset", async () => {
    useSettingsStore.getState().setEditorMathPreview(false);
    useSettingsStore.getState().setEditorTheme("dracula");
    renderSection();
    const reset = screen.getByRole("button", { name: fill(changed.reset, mathPreview) });

    reset.focus();
    fireEvent.click(reset);

    const theme = enSettings.appearance.editor.theme.label;
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: fill(changed.showAriaLabel, theme) }),
      ),
    );
  });

  it("moves keyboard focus to the list after the last reset", async () => {
    useSettingsStore.getState().setEditorMathPreview(false);
    renderSection();
    const reset = screen.getByRole("button", { name: fill(changed.reset, mathPreview) });

    reset.focus();
    fireEvent.click(reset);

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByText(changed.empty).closest("[tabindex]")),
    );
  });

  it("resets the app theme through the theme provider", () => {
    themeMocks.preference = "dark";
    renderSection();
    const label = enSettings.appearance.app.theme.label;

    expect(screen.getByTestId("changed-setting-theme")).toHaveTextContent(`${label}Dark`);
    fireEvent.click(screen.getByRole("button", { name: fill(changed.reset, label) }));

    expect(themeMocks.setPreference).toHaveBeenCalledWith("system");
  });
});
