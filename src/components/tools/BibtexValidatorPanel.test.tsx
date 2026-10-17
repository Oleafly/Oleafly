// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
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

function bibliography(count: number, withoutYearAt = -1) {
  return Array.from(
    { length: count },
    (_, index) =>
      `@article{key${index},\n  author  = {Lovelace, Ada},\n  title   = {Study ${index} ${"of attention ".repeat(40)}},\n  journal = {Notes}${index === withoutYearAt ? "" : ",\n  year    = {2001}"}\n}`,
  ).join("\n\n");
}

function replaceInput(text: string) {
  const editor = screen.getByTestId("bibtex-code-field").querySelector(".cm-editor");
  const view = editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null;
  if (!view) throw new Error("no CodeMirror view");
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  });
}

describe("BibtexValidatorPanel with a long bibliography", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for a pause in typing before validating it again", () => {
    vi.useFakeTimers();
    render(<BibtexValidatorPanel />);
    replaceInput(bibliography(60));
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getAllByText(enResearchTools.bibtex.looksGood)).toHaveLength(60);

    replaceInput(bibliography(60, 59));
    expect(screen.getAllByText(enResearchTools.bibtex.looksGood)).toHaveLength(60);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getAllByText(enResearchTools.bibtex.looksGood)).toHaveLength(59);
  });

  it("validates a short bibliography on every change", () => {
    render(<BibtexValidatorPanel />);
    replaceInput(bibliography(2));
    expect(screen.getAllByText(enResearchTools.bibtex.looksGood)).toHaveLength(2);
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
