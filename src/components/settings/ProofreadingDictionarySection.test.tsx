// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDictionary } from "@/lib/dictionary";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { ProofreadingDictionarySection } from "./ProofreadingDictionarySection";

describe("Turned off rules and findings", () => {
  beforeEach(() => {
    localStorage.clear();
    useDictionary.getState().clearAll();
    useSettingsStore.getState().setHarperDisabledRules([]);
    useFilesStore.setState({ projectId: "project-a" });
  });

  it("says nothing is turned off when every rule is on", () => {
    render(<ProofreadingDictionarySection />);

    expect(
      screen.getByText("No grammar rules are turned off."),
    ).toBeInTheDocument();
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
