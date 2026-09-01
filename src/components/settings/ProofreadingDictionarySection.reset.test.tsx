// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDictionary } from "@/lib/dictionary";
import { useSettingsStore } from "@/store/settings";
import { ProofreadingDictionarySection } from "./ProofreadingDictionarySection";

describe("Dictionary reset", () => {
  beforeEach(() => {
    localStorage.clear();
    useDictionary.getState().clearAll();
    useSettingsStore.getState().setDictionaryLocale("fr_FR");
  });

  it("clears global and project words after confirmation without changing the dictionary locale", () => {
    useDictionary.getState().ignoreGlobal("Oleafly");
    useDictionary.getState().ignore("project-reset-test", "TeXLab");

    render(<ProofreadingDictionarySection />);

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

    const confirmation = screen.getByRole("alertdialog", {
      name: /Reset Dictionary settings/u,
    });
    expect(confirmation).toHaveTextContent(
      "This permanently removes every ignored word, global and per-project.",
    );
    expect(useDictionary.getState()).toMatchObject({
      global: ["Oleafly"],
      ignored: { "project-reset-test": ["TeXLab"] },
    });

    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Reset to defaults" }),
    );

    expect(useDictionary.getState()).toMatchObject({ global: [], ignored: {} });
    const persisted = JSON.parse(
      localStorage.getItem("oleafly.dictionary") ?? "{}",
    ) as { state?: { global?: string[]; ignored?: Record<string, string[]> } };
    expect(persisted.state).toMatchObject({ global: [], ignored: {} });
    expect(useSettingsStore.getState().dictionaryLocale).toBe("fr_FR");
    expect(localStorage.getItem("oleafly.dictionary.locale")).toBe("fr_FR");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
