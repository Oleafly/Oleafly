// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useDictionary } from "@/lib/dictionary";
import { useSettingsStore } from "@/store/settings";
import { ChangedSettingsProvider } from "./changed-settings";
import { ProofreadingDictionarySection } from "./ProofreadingDictionarySection";

vi.mock("@/lib/theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/theme")>()),
  useTheme: () => ({
    preference: "system",
    theme: "dark",
    setPreference: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

describe("Dictionary reset", () => {
  beforeEach(() => {
    localStorage.clear();
    useDictionary.getState().clearAll();
    useSettingsStore.getState().setDictionaryLocale("fr_FR");
  });

  it("clears global and project words after confirmation without changing the dictionary locale", () => {
    useDictionary.getState().ignoreGlobal("Oleafly");
    useDictionary.getState().ignore("project-reset-test", "TeXLab");
    useSettingsStore.getState().setHarperDisabledRules(["AnA"]);
    useSettingsStore.getState().setHarperEnabledRules(["Hedging"]);

    render(<ProofreadingDictionarySection />);

    fireEvent.click(
      screen.getByRole("button", { name: enSettings.reset.button }),
    );

    const confirmation = screen.getByRole("alertdialog", {
      name: enSettings.reset.confirmTitle.replace(
        "{{sectionName}}",
        enSettings.proofreading.reset.sectionName,
      ),
    });
    expect(confirmation).toHaveTextContent(
      enSettings.proofreading.reset.confirmationDescription,
    );
    expect(useDictionary.getState()).toMatchObject({
      global: ["Oleafly"],
      ignored: { "project-reset-test": ["TeXLab"] },
    });

    fireEvent.click(
      within(confirmation).getByRole("button", { name: enSettings.reset.button }),
    );

    expect(useDictionary.getState()).toMatchObject({ global: [], ignored: {} });
    expect(useSettingsStore.getState().harperDisabledRules).toEqual([]);
    expect(useSettingsStore.getState().harperEnabledRules).toEqual([]);
    const persisted = JSON.parse(
      localStorage.getItem("oleafly.dictionary") ?? "{}",
    ) as { state?: { global?: string[]; ignored?: Record<string, string[]> } };
    expect(persisted.state).toMatchObject({ global: [], ignored: {} });
    expect(useSettingsStore.getState().dictionaryLocale).toBe("fr_FR");
    expect(localStorage.getItem("oleafly.dictionary.locale")).toBe("fr_FR");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it.each([
    {
      heading: enSettings.proofreading.profileRules.title,
      resetLabel: enSettings.proofreading.profileRules.title,
    },
    {
      heading: enSettings.proofreading.turnedOff.title,
      resetLabel: enSettings.proofreading.turnedOff.listAriaLabel,
    },
  ])("puts the $heading Reset at the right edge of its header", ({ heading, resetLabel }) => {
    useSettingsStore.getState().setHarperDisabledRules(["AnA"]);
    useSettingsStore.getState().setHarperEnabledRules(["Hedging"]);
    render(
      <ChangedSettingsProvider>
        <ProofreadingDictionarySection />
      </ChangedSettingsProvider>,
    );
    const reset = screen.getByRole("button", {
      name: enSettings.changed.reset.replace("{{label}}", resetLabel),
    });
    const header = screen.getByRole("heading", {
      name: `${heading} ${enSettings.changed.marker}`,
    }).parentElement;
    if (!header) throw new Error(`${heading} header is missing`);

    const item = [...header.children].find((child) => child.contains(reset));
    expect(item).toHaveClass("ml-auto");
  });
});
