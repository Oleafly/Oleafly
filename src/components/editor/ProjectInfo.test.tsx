// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_DOCUMENT_STATS } from "@/lib/document-stats";
import { useFilesStore } from "@/store/files";
import { useProofreadingStore } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";
import { ProjectInfoContent } from "./ProjectInfo";

const SNAPSHOT = {
  root: "/books/guide/main.tex",
  fileCount: 3,
  unreadable: ["missing-a.tex", "missing-b.tex"],
  stats: {
    ...EMPTY_DOCUMENT_STATS,
    words: 42,
    wordsInText: 30,
    wordsInHeaders: 7,
    wordsOutsideText: 5,
    characters: 240,
    lines: 12,
  },
  selectionWords: 4,
};

const IDLE = {
  phase: "idle" as const,
  identity: null,
  message: null,
  diagnosticCount: 0,
  diagnostics: [],
  truncated: false,
  activeDictionaryLocale: null,
};

describe("ProjectInfoContent", () => {
  beforeEach(() => {
    useFilesStore.setState({ activePath: "chapters/intro.tex" });
    useSettingsStore.setState({ spellcheck: true, harper: true });
    useProofreadingStore.setState({ source: IDLE });
  });

  it("shows loading state before document statistics arrive", () => {
    render(<ProjectInfoContent snapshot={null} surface="source" />);

    expect(screen.getByText("Counting…")).toBeInTheDocument();
    expect(screen.getByText("Counting the document…")).toBeInTheDocument();
  });

  it("renders document, selection, unreadable-file, and proofreading details", () => {
    useProofreadingStore.setState({
      source: {
        ...IDLE,
        phase: "partial",
        diagnosticCount: 2,
        diagnostics: [
          {
            from: 0,
            to: 4,
            message: "Spelling",
            kind: "Spelling",
            source: "hunspell",
            word: "teh",
            suggestions: [{ text: "the", kind: 0 }],
          },
          {
            from: 5,
            to: 9,
            message: "Style",
            kind: "Grammar",
            source: "harper",
            word: "very",
            suggestions: [],
          },
        ],
        truncated: true,
      },
    });

    render(<ProjectInfoContent snapshot={SNAPSHOT} surface="source" />);

    expect(screen.getByText("main.tex · 3 files")).toBeInTheDocument();
    expect(screen.getByText("Selection")).toBeInTheDocument();
    expect(screen.getByText(/2 included files could not be read/u)).toBeInTheDocument();
    expect(screen.getByText("Proofreading · intro.tex")).toBeInTheDocument();
    expect(screen.getByText("Spelling")).toBeInTheDocument();
    expect(screen.getByText("Grammar & style")).toBeInTheDocument();
    expect(screen.getByText(/findings list is truncated/u)).toBeInTheDocument();
  });

  it("covers disabled, checking, and unavailable proofreading states", () => {
    useSettingsStore.setState({ spellcheck: false, harper: false });
    const view = render(
      <ProjectInfoContent
        snapshot={{ ...SNAPSHOT, fileCount: 1, unreadable: [], selectionWords: null }}
        surface="source"
      />,
    );
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.getByText("main.tex")).toBeInTheDocument();

    act(() => {
      useSettingsStore.setState({ spellcheck: true });
      useProofreadingStore.setState({ source: { ...IDLE, phase: "loading" } });
    });
    expect(screen.getByText("Checking…")).toBeInTheDocument();

    act(() => {
      useProofreadingStore.setState({ source: { ...IDLE, phase: "error" } });
    });
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    view.unmount();
  });
});
