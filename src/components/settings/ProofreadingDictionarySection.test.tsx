// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useDictionary } from "@/lib/dictionary";
import {
  ACADEMIC_PROFILE_RULES,
  buildLintConfig,
} from "@/lib/proofreading/lint-profile";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { ProofreadingDictionarySection } from "./ProofreadingDictionarySection";

function toggleName(rule: string): string {
  return enSettings.proofreading.profileRules.toggleAriaLabel.replace(
    "{{rule}}",
    rule,
  );
}

describe("Grammar rules and dismissed findings", () => {
  beforeEach(() => {
    localStorage.clear();
    useDictionary.getState().clearAll();
    useSettingsStore.getState().setHarperDisabledRules([]);
    useSettingsStore.getState().setHarperEnabledRules([]);
    useFilesStore.setState({ projectId: "project-a" });
  });

  it("says what the writer turned off without denying the profile defaults", () => {
    render(<ProofreadingDictionarySection />);

    expect(
      screen.getByText(enSettings.proofreading.turnedOff.none),
    ).toBeInTheDocument();
    expect(screen.queryByText("No grammar rules are turned off.")).toBeNull();
  });

  it("lists every rule the writer turned off", () => {
    useSettingsStore
      .getState()
      .setHarperDisabledRules(["RepeatedWords", "AnA"]);

    render(<ProofreadingDictionarySection />);

    const list = screen.getByRole("list", {
      name: enSettings.proofreading.turnedOff.listAriaLabel,
    });
    expect(list).toHaveTextContent("AnA");
    expect(list).toHaveTextContent("RepeatedWords");
  });

  it("turns a rule back on from the list", () => {
    useSettingsStore.getState().setHarperDisabledRules(["RepeatedWords"]);

    render(<ProofreadingDictionarySection />);
    fireEvent.click(
      screen.getByRole("button", {
        name: enSettings.proofreading.turnedOff.restoreAriaLabel.replace(
          "{{rule}}",
          "RepeatedWords",
        ),
      }),
    );

    expect(useSettingsStore.getState().harperDisabledRules).toEqual([]);
  });

  it("lists every rule the academic profile turns off with its reason", () => {
    render(<ProofreadingDictionarySection />);

    const list = screen.getByRole("list", {
      name: enSettings.proofreading.profileRules.title,
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(26);
    expect(ACADEMIC_PROFILE_RULES).toHaveLength(26);
    for (const { rule, example } of ACADEMIC_PROFILE_RULES) {
      expect(
        [...list.querySelectorAll("p")].some(
          (paragraph) =>
            paragraph.textContent ===
            enSettings.proofreading.profileRules.example.replace(
              "{{example}}",
              example,
            ),
        ),
        rule,
      ).toBe(true);
      expect(within(list).getByText(rule)).toBeInTheDocument();
      expect(
        within(list).getByText(enSettings.proofreading.profileRules.reasons[rule]),
      ).toBeInTheDocument();
      expect(
        within(list).getByRole("switch", { name: toggleName(rule) }),
      ).not.toBeChecked();
    }
  });

  it("turns a profile rule on and off again through harperEnabledRules", () => {
    render(<ProofreadingDictionarySection />);
    const toggle = screen.getByRole("switch", { name: toggleName("Hedging") });

    fireEvent.click(toggle);

    expect(useSettingsStore.getState().harperEnabledRules).toEqual([
      "Hedging",
    ]);
    expect(
      JSON.parse(
        localStorage.getItem("oleafly.harper.enabledRules") ?? "[]",
      ),
    ).toEqual(["Hedging"]);
    expect(toggle).toBeChecked();
    expect(
      buildLintConfig(
        useSettingsStore.getState().harperDisabledRules,
        useSettingsStore.getState().harperEnabledRules,
      ).Hedging,
    ).toBe(true);

    fireEvent.click(toggle);

    expect(useSettingsStore.getState().harperEnabledRules).toEqual([]);
    expect(toggle).not.toBeChecked();
    expect(
      buildLintConfig(
        useSettingsStore.getState().harperDisabledRules,
        useSettingsStore.getState().harperEnabledRules,
      ).Hedging,
    ).toBe(false);
  });

  it("announces the change so open editors lint again", () => {
    const seen: string[] = [];
    const listener = (event: Event) => {
      seen.push(
        (event as CustomEvent<{ setting: string }>).detail.setting,
      );
    };
    window.addEventListener("oleafly:proofreading-settings-changed", listener);
    render(<ProofreadingDictionarySection />);

    fireEvent.click(screen.getByRole("switch", { name: toggleName("Dashes") }));
    window.removeEventListener(
      "oleafly:proofreading-settings-changed",
      listener,
    );

    expect(seen).toContain("harperEnabledRules");
  });

  it("shows a profile rule as off while the writer also has it turned off", () => {
    useSettingsStore.getState().setHarperEnabledRules(["Hedging"]);
    useSettingsStore.getState().setHarperDisabledRules(["Hedging"]);

    render(<ProofreadingDictionarySection />);
    const toggle = screen.getByRole("switch", { name: toggleName("Hedging") });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    expect(useSettingsStore.getState().harperDisabledRules).toEqual([]);
    expect(useSettingsStore.getState().harperEnabledRules).toEqual([
      "Hedging",
    ]);
  });

  it("counts the findings dismissed in the open project", () => {
    useDictionary.getState().suppress("project-a", "RepeatedWords:one.");
    useDictionary.getState().suppress("project-a", "AnA:two.");
    useDictionary.getState().suppress("project-b", "AnA:three.");

    render(<ProofreadingDictionarySection />);

    expect(
      screen.getByTestId("dictionary-suppressed-count"),
    ).toHaveTextContent("2 / 500");
  });

  it("shows dismissed findings again after confirmation", () => {
    useDictionary.getState().suppress("project-a", "RepeatedWords:one.");

    render(<ProofreadingDictionarySection />);
    fireEvent.click(
      screen.getByRole("button", {
        name: enSettings.proofreading.dismissed.showAgain,
      }),
    );

    const confirmation = screen.getByRole("alertdialog", {
      name: enSettings.proofreading.clear.suppressedTitle,
    });
    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: enSettings.proofreading.clear.suppressedConfirm,
      }),
    );

    expect(useDictionary.getState().suppressed["project-a"] ?? []).toEqual([]);
  });
});
