// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/tauri", () => ({
  getConfig: vi.fn(async () => ({})),
}));

vi.mock("@/lib/ai-providers", () => ({
  hasConfiguredProvider: vi.fn(() => false),
}));

vi.mock("@/features/citation", () => ({
  addCitation: vi.fn(),
}));

vi.mock("@/lib/document-citation", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/document-citation")
  >("@/lib/document-citation");
  return {
    ...actual,
    scanDocumentForCitations: vi.fn(async () => ({
      paragraphs: [],
      totalParagraphs: 0,
    })),
  };
});

import { LiteratureSearchPanel } from "@/components/tools/LiteratureSearchPanel";
import { DocumentCitationScanPanel } from "@/components/tools/DocumentCitationScanPanel";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";

beforeEach(() => {
  useSettingsStore.setState({ offline: false });
  useFilesStore.setState({
    projectId: "proj-1",
    activePath: "main.tex",
    mainDoc: "main.tex",
    tree: [{ path: "main.tex", is_dir: false, name: "main.tex" } as never],
    files: {
      "main.tex": {
        content:
          "Deep learning models require large datasets for training.\n\nTransformers improve sequence modeling.",
        dirty: false,
      },
    },
  });
});

describe("DocumentCitationScanPanel", () => {
  it("renders Find citations control", () => {
    render(<DocumentCitationScanPanel />);
    expect(screen.getByTestId("document-citation-scan")).toBeInTheDocument();
    expect(screen.getByTestId("document-citation-scan")).toHaveTextContent(
      "Find citations",
    );
  });

  it("shows heuristic ranking banner when no AI provider is configured", async () => {
    render(<DocumentCitationScanPanel />);
    expect(
      await screen.findByText(
        /Ranking will use citation counts only until an AI provider is configured/i,
      ),
    ).toBeInTheDocument();
  });
});

describe("LiteratureSearchPanel mode toggle", () => {
  it("switches to From document mode and shows scan panel", () => {
    render(<LiteratureSearchPanel />);
    expect(screen.getByTestId("citation-search-mode")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("citation-search-mode-document"));
    expect(screen.getByTestId("document-citation-scan")).toBeInTheDocument();
  });
});
