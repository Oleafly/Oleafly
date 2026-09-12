// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { BibtexValidatorPanel } from "@/components/tools/BibtexValidatorPanel";
import { BibtexToolView } from "@/components/tools/BibtexToolView";
import { useHomeViewStore } from "@/store/home-view";
import { toolName } from "@/lib/tool-catalog";

function codeMirrorContent() {
  const field = screen.getByTestId("bibtex-code-field");
  const line = field.querySelector(".cm-content");
  if (!(line instanceof HTMLElement)) throw new Error("no CodeMirror content");
  return line;
}

beforeEach(() => {
  useHomeViewStore.setState({ page: "library" });
});

describe("BibtexValidatorPanel", () => {
  it("shows the empty results hint before anything is pasted", () => {
    render(<BibtexValidatorPanel />);
    expect(
      screen.getByText(enResearchTools.bibtex.empty),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.bibtex.inputHeading),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.bibtex.resultsHeading),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        enResearchTools.bibtex.entryCount_other.replace("{{count}}", "0"),
      ),
    ).toBeInTheDocument();
    expect(codeMirrorContent()).toBeInTheDocument();
  });

  it("renders an example's findings when its chip is clicked", () => {
    render(<BibtexValidatorPanel />);
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.bibtex.exampleValid,
      }),
    );
    expect(
      screen.getByText(enResearchTools.bibtex.looksGood),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        enResearchTools.bibtex.entryCount_one.replace("{{count}}", "1"),
      ),
    ).toBeInTheDocument();
  });

  it("flags a missing required field", () => {
    render(<BibtexValidatorPanel />);
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.bibtex.exampleMissing,
      }),
    );
    expect(
      screen.queryByText(enResearchTools.bibtex.looksGood),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/journal/i)).toBeInTheDocument();
  });

  it("flags duplicate citation keys and clears back to the empty state", () => {
    render(<BibtexValidatorPanel />);
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.bibtex.exampleDuplicate,
      }),
    );
    expect(
      screen.getByText(
        enResearchTools.bibtex.entryCount_other.replace("{{count}}", "2"),
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/shannon1948/).length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", { name: enCommon.actions.clear }),
    );
    expect(
      screen.getByText(enResearchTools.bibtex.empty),
    ).toBeInTheDocument();
  });
});

describe("BibtexToolView", () => {
  it("renders the validator inside the tool shell when its page is active", () => {
    useHomeViewStore.setState({ page: "bibtex" });
    render(<BibtexToolView />);
    expect(screen.getByTestId("bibtex-tool-view")).toBeInTheDocument();
    expect(screen.getByText(toolName("bibtex"))).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.bibtex.subtitle),
    ).toBeInTheDocument();
    expect(screen.getByTestId("bibtex-code-field")).toBeInTheDocument();
  });
});
