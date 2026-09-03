// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_DOCUMENT_STATS } from "@/lib/document-stats";
import { useFilesStore } from "@/store/files";
import { useProofreadingStore } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";

const collectProjectInfoMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/editor/project-info-data", () => ({
  collectProjectInfo: collectProjectInfoMock,
}));

vi.mock("@/components/editor/wysiwyg/controller", () => ({
  isWysiwygActive: () => false,
}));

import { WordCountModal } from "./WordCountModal";

const SNAPSHOT = {
  root: "main.tex",
  fileCount: 3,
  unreadable: [],
  stats: {
    ...EMPTY_DOCUMENT_STATS,
    words: 421,
    wordsInText: 400,
    wordsInHeaders: 14,
    wordsOutsideText: 7,
    headers: 5,
    characters: 900,
    lines: 30,
  },
  selectionWords: null,
};

describe("WordCountModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFilesStore.setState({ activePath: "main.tex" });
    useSettingsStore.setState({ wordCountOpen: false, spellcheck: false, harper: false });
    useProofreadingStore.setState({
      source: {
        phase: "idle",
        identity: null,
        message: null,
        diagnosticCount: 0,
        diagnostics: [],
        truncated: false,
        activeDictionaryLocale: null,
      },
    });
  });

  it("renders nothing and collects nothing while closed", () => {
    const { container } = render(<WordCountModal />);

    expect(container).toBeEmptyDOMElement();
    expect(collectProjectInfoMock).not.toHaveBeenCalled();
  });

  it("collects the document counts once when opened and shows them", async () => {
    collectProjectInfoMock.mockResolvedValue(SNAPSHOT);
    useSettingsStore.setState({ wordCountOpen: true });

    render(<WordCountModal />);

    expect(collectProjectInfoMock).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText("421")).toBeInTheDocument());
    expect(screen.getByText("Words")).toBeInTheDocument();
  });

  it("closes from the Close button", async () => {
    collectProjectInfoMock.mockResolvedValue(SNAPSHOT);
    useSettingsStore.setState({ wordCountOpen: true });

    render(<WordCountModal />);
    await waitFor(() => expect(screen.getByText("421")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(useSettingsStore.getState().wordCountOpen).toBe(false);
  });
});
