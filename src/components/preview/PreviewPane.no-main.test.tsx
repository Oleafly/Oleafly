// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";

vi.mock("@/components/pdf/PdfViewer", () => ({ PdfViewer: () => null }));
vi.mock("@/components/editor/LogPane", () => ({ LogPane: () => null }));
vi.mock("@/features/synctex", () => ({
  canUseSyncTexForCheckpoint: vi.fn(() => false),
  inverseFromClick: vi.fn(),
}));
vi.mock("@/features/ask-ai-compile-errors", () => ({ askAiAboutCompileErrors: vi.fn() }));
vi.mock("@/lib/preview-window", () => ({ openPreviewWindow: vi.fn() }));
vi.mock("@/components/ui/toolbar-overflow", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAvailableWidth: () => ({
    containerRef: () => {},
    availableWidth: Number.POSITIVE_INFINITY,
  }),
}));

import { PreviewPane } from "./PreviewPane";

function show(tree: { path: string; is_dir: boolean }[], status = "unavailable") {
  useFilesStore.setState({
    projectId: "linked-a",
    projectName: "Notes",
    projectKind: "",
    manifestHome: "device",
    mainDoc: "main.tex",
    tree,
    engineLoaded: true,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useCompileStore.setState({
    status,
    phase: "idle",
    log: "",
    errors: [],
    failureReason: status === "unavailable" ? enShell.openedFolder.noMain : null,
    pdfBytes: null,
    lastCompileCheckpoint: null,
    lastAttemptIdentity: null,
    recompile: vi.fn(),
  } as unknown as ReturnType<typeof useCompileStore.getState>);
  render(<PreviewPane />);
}

describe("preview of an opened folder without a main document", () => {
  beforeEach(() => {
    useCompileStore.getState().reset();
  });

  it("says how to pick a main document and offers no retry", () => {
    show([{ path: "notes/draft.md", is_dir: false }]);
    expect(screen.getByText(enShell.openedFolder.noMain)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: enPreview.actions.retryCompile }),
    ).not.toBeInTheDocument();
  });

  it("says the same before any compile was attempted, such as for an empty folder", () => {
    show([], "idle");
    expect(screen.getByText(enShell.openedFolder.noMain)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: enPreview.actions.retryCompile }),
    ).not.toBeInTheDocument();
  });

  it("keeps the retry for other reasons compiling is unavailable", () => {
    show([{ path: "main.tex", is_dir: false }]);
    expect(
      screen.getByRole("button", { name: enPreview.actions.retryCompile }),
    ).toBeInTheDocument();
  });
});
