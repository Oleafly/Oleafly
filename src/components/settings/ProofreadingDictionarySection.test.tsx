// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDictionary } from "@/lib/dictionary";
import {
  ACADEMIC_DISABLED_RULES,
  ACADEMIC_PROFILE_RULES,
  buildLintConfig,
} from "@/lib/proofreading/lint-profile";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { ProofreadingDictionarySection } from "./ProofreadingDictionarySection";

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
      screen.getByText(
        `You have not turned off any rules. The ${ACADEMIC_DISABLED_RULES.length} rules below are off because the academic profile keeps them off. Turn on any you want.`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("No grammar rules are turned off.")).toBeNull();
  });

  it("lists every rule the writer turned off", () => {
    useSettingsStore
      .getState()
      .setHarperDisabledRules(["RepeatedWords", "AnA"]);

    render(<ProofreadingDictionarySection />);

    const list = screen.getByRole("list", {
      name: "Grammar rules turned off",
    });
    expect(list).toHaveTextContent("AnA");
    expect(list).toHaveTextContent("RepeatedWords");
  });

  it("turns a rule back on from the list", () => {
    useSettingsStore.getState().setHarperDisabledRules(["RepeatedWords"]);

    render(<ProofreadingDictionarySection />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Turn the RepeatedWords rule back on",
      }),
    );

    expect(useSettingsStore.getState().harperDisabledRules).toEqual([]);
  });

  it("lists every rule the academic profile turns off with its reason", () => {
    render(<ProofreadingDictionarySection />);

    const list = screen.getByRole("list", {
      name: "Rules the academic profile keeps off",
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(27);
    expect(ACADEMIC_PROFILE_RULES).toHaveLength(27);
    for (const { rule, reason, example } of ACADEMIC_PROFILE_RULES) {
      expect(
        [...list.querySelectorAll("p")].some(
          (paragraph) => paragraph.textContent === `Example: ${example}`,
        ),
        rule,
      ).toBe(true);
      expect(within(list).getByText(rule)).toBeInTheDocument();
      expect(within(list).getByText(reason)).toBeInTheDocument();
      expect(
        within(list).getByRole("switch", { name: `Turn on ${rule}` }),
      ).not.toBeChecked();
    }
  });

  it("turns a profile rule on and off again through harperEnabledRules", () => {
    render(<ProofreadingDictionarySection />);
    const toggle = screen.getByRole("switch", { name: "Turn on Hedging" });

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

    fireEvent.click(screen.getByRole("switch", { name: "Turn on Dashes" }));
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
    const toggle = screen.getByRole("switch", { name: "Turn on Hedging" });
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
    fireEvent.click(screen.getByRole("button", { name: /Show again/u }));

    const confirmation = screen.getByRole("alertdialog", {
      name: /Show dismissed findings again/u,
    });
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Show again" }),
    );

    expect(useDictionary.getState().suppressed["project-a"] ?? []).toEqual([]);
  });
});
