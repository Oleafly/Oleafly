// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useDictionary } from "@/lib/dictionary";
import { useFilesStore } from "@/store/files";
import { ProofreadingDictionarySection } from "./ProofreadingDictionarySection";

const copy = enSettings.proofreading;

function confirmation() {
  return screen.getByRole("alertdialog", { name: copy.clear.title });
}

beforeEach(() => {
  localStorage.clear();
  useDictionary.getState().clearAll();
  useFilesStore.setState({
    projectId: "thesis",
    projects: [
      { id: "thesis", name: "Thesis" },
      { id: "notes", name: "Notes" },
    ] as never[],
  });
});

describe("global ignored words", () => {
  it("adds words, lists them in order and filters them by the search", async () => {
    const user = userEvent.setup();
    render(<ProofreadingDictionarySection />);
    const field = screen.getByRole("textbox", { name: copy.addWord.globalAriaLabel });

    expect(screen.getByRole("button", { name: copy.addWord.submitAriaLabel })).toBeDisabled();
    fireEvent.submit(field);
    expect(useDictionary.getState().global).toEqual([]);

    await user.type(field, "zeta{Enter}");
    await user.type(field, "Alpha{Enter}");

    expect(field).toHaveValue("");
    const list = screen.getByRole("list", { name: copy.words.listAriaLabel });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Alpha", "zeta"]);

    await user.type(screen.getByRole("searchbox", { name: copy.search.ariaLabel }), "nothing");
    expect(screen.getByText(copy.words.noMatches)).toBeInTheDocument();
  });

  it("removes one word and clears them all after confirmation", async () => {
    const user = userEvent.setup();
    useDictionary.getState().ignoreGlobal("Oleafly");
    useDictionary.getState().ignoreGlobal("Typst");
    render(<ProofreadingDictionarySection />);

    await user.click(screen.getByRole("button", { name: copy.words.removeAriaLabel.replace("{{word}}", "Typst") }));
    expect(useDictionary.getState().global).toEqual(["Oleafly"]);

    await user.click(screen.getByRole("button", { name: enCommon.actions.clear }));
    expect(within(confirmation()).getByText(copy.clear.descriptionGlobal)).toBeInTheDocument();
    await user.click(within(confirmation()).getByRole("button", { name: new RegExp(`^${enCommon.actions.cancel}`) }));
    expect(useDictionary.getState().global).toEqual(["Oleafly"]);

    await user.click(screen.getByRole("button", { name: enCommon.actions.clear }));
    await user.click(within(confirmation()).getByRole("button", { name: copy.clear.confirm }));
    expect(useDictionary.getState().global).toEqual([]);
    expect(screen.getByText(copy.words.emptyTitle)).toBeInTheDocument();
  });
});

describe("project ignored words", () => {
  it("lists projects by name, adds words to the open one and clears another", async () => {
    const user = userEvent.setup();
    useDictionary.getState().ignore("notes", "lemma");
    render(<ProofreadingDictionarySection />);

    await user.click(screen.getByTestId("dictionary-tab-projects"));
    const sections = [screen.getByRole("region", { name: "Notes" }), screen.getByRole("region", { name: "Thesis" })];
    expect(sections[0].compareDocumentPosition(sections[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(sections[1]).getByText(copy.words.emptyCompact)).toBeInTheDocument();

    await user.type(
      within(sections[1]).getByRole("textbox", { name: copy.addWord.projectAriaLabel.replace("{{project}}", "Thesis") }),
      "corpus{Enter}",
    );
    expect(useDictionary.getState().ignored.thesis).toEqual(["corpus"]);
    await user.click(within(sections[1]).getByRole("button", { name: copy.words.removeAriaLabel.replace("{{word}}", "corpus") }));
    expect(useDictionary.getState().ignored.thesis ?? []).toEqual([]);

    await user.click(within(sections[0]).getByRole("button", { name: enCommon.actions.clear }));
    expect(within(confirmation()).getByText(copy.clear.descriptionProject.replace("{{project}}", "Notes"))).toBeInTheDocument();
    await user.click(within(confirmation()).getByRole("button", { name: copy.clear.confirm }));
    expect(useDictionary.getState().ignored.notes ?? []).toEqual([]);
  });

  it("asks for a project when none is open", async () => {
    const user = userEvent.setup();
    useFilesStore.setState({ projectId: null });
    render(<ProofreadingDictionarySection />);

    await user.click(screen.getByTestId("dictionary-tab-projects"));

    expect(screen.getByText(copy.projects.empty)).toBeInTheDocument();
  });
});
