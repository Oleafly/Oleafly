// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getConfig = vi.fn(async () => ({}) as unknown);
const hasConfiguredProvider = vi.fn((_config?: unknown) => true);
const runPaperReview = vi.fn(async (_args?: unknown) => "");

vi.mock("@/lib/tauri", () => ({
  getConfig: () => getConfig(),
}));

vi.mock("@/lib/ai-providers", () => ({
  hasConfiguredProvider: (config: unknown) => hasConfiguredProvider(config),
}));

vi.mock("@/lib/document-citation", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/document-citation")>(
      "@/lib/document-citation",
    );
  return {
    ...actual,
    runPaperReview: (args: unknown) => runPaperReview(args),
  };
});

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { PaperReviewPanel } from "@/components/tools/PaperReviewPanel";
import { useDocumentCitationUiStore } from "@/store/document-citation-ui";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const PAPER = "We present a method.\n\nIt outperforms the baseline.";

function seedProject(content = PAPER) {
  useFilesStore.setState({
    projectId: "proj-1",
    activePath: "main.tex",
    mainDoc: "main.tex",
    tree: [{ path: "main.tex", is_dir: false, name: "main.tex" } as never],
    files: { "main.tex": { content, dirty: false } },
  });
}

async function renderReady() {
  render(<PaperReviewPanel />);
  await waitFor(() =>
    expect(screen.getByTestId("paper-review-run")).not.toBeDisabled(),
  );
}

beforeEach(() => {
  getConfig.mockReset();
  getConfig.mockResolvedValue({});
  hasConfiguredProvider.mockReset();
  hasConfiguredProvider.mockReturnValue(true);
  runPaperReview.mockReset();
  runPaperReview.mockResolvedValue("");
  useSettingsStore.setState({ offline: false });
  useDocumentCitationUiStore.setState({
    modeRequest: "search",
    selectionOverride: null,
    bibOverride: null,
  });
  seedProject();
});

describe("PaperReviewPanel", () => {
  it("renders the friendly hint and both mode buttons", async () => {
    await renderReady();
    expect(screen.getByTestId("paper-review-panel")).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.review.friendlyHint),
    ).toBeInTheDocument();
    expect(screen.getByTestId("paper-review-mode-friendly")).toBeInTheDocument();
    expect(screen.getByTestId("paper-review-run")).toHaveTextContent(
      enResearchTools.review.runReview,
    );
  });

  it("switches to fire mode and shows its hint", async () => {
    await renderReady();
    fireEvent.click(screen.getByTestId("paper-review-mode-fire"));
    expect(
      screen.getByText(enResearchTools.review.fireHint),
    ).toBeInTheDocument();
  });

  it("warns and blocks the run while offline", async () => {
    useSettingsStore.setState({ offline: true });
    render(<PaperReviewPanel />);
    expect(
      await screen.findByText(enResearchTools.review.offline),
    ).toBeInTheDocument();
    expect(screen.getByTestId("paper-review-run")).toBeDisabled();
  });

  it("warns when no AI provider is configured", async () => {
    hasConfiguredProvider.mockReturnValue(false);
    render(<PaperReviewPanel />);
    expect(
      await screen.findByText(enResearchTools.review.needsProvider),
    ).toBeInTheDocument();
    expect(screen.getByTestId("paper-review-run")).toBeDisabled();
  });

  it("explains that there is no source text without a project", async () => {
    useFilesStore.setState({
      projectId: null,
      activePath: null,
      mainDoc: "",
      tree: [],
      files: {},
    });
    render(<PaperReviewPanel />);
    expect(
      await screen.findByText(enResearchTools.review.noSource),
    ).toBeInTheDocument();
  });

  it("streams review markdown and then offers a clear control", async () => {
    runPaperReview.mockImplementation(async (args?: unknown) => {
      const onChunk = (args as { onChunk?: (full: string) => void } | undefined)
        ?.onChunk;
      onChunk?.(
        "## Strengths\n\n- **Clear** framing\n- Solid baselines\n\nThe claims hold up.",
      );
      return "";
    });
    await renderReady();
    fireEvent.click(screen.getByTestId("paper-review-run"));

    await waitFor(() =>
      expect(screen.getByTestId("paper-review-clear")).toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: /Strengths/ })).toBeInTheDocument();
    expect(screen.getByText(/Clear framing/)).toBeInTheDocument();
    expect(screen.getByText(/The claims hold up/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("paper-review-clear"));
    expect(
      screen.getByText(enResearchTools.review.friendlyHint),
    ).toBeInTheDocument();
  });

  it("sends the selection override as the paper text", async () => {
    useDocumentCitationUiStore
      .getState()
      .requestDocumentScan("Only the highlighted passage.");
    await renderReady();
    fireEvent.click(screen.getByTestId("paper-review-run"));
    await waitFor(() => expect(runPaperReview).toHaveBeenCalledTimes(1));
    expect(runPaperReview).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "friendly",
        paperText: "Only the highlighted passage.",
      }),
    );
  });

  it("surfaces a review failure", async () => {
    runPaperReview.mockRejectedValue(new Error("model unavailable"));
    await renderReady();
    fireEvent.click(screen.getByTestId("paper-review-run"));
    await waitFor(() =>
      expect(screen.getByTestId("paper-review-error")).toHaveTextContent(
        "model unavailable",
      ),
    );
  });

  it("swallows an abort and shows the cancel control while running", async () => {
    const pending: { release: (() => void) | null } = { release: null };
    runPaperReview.mockImplementation(
      () =>
        new Promise<string>((_resolve, reject) => {
          pending.release = () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
        }),
    );
    await renderReady();
    fireEvent.click(screen.getByTestId("paper-review-run"));
    await waitFor(() =>
      expect(screen.getByTestId("paper-review-cancel")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(enResearchTools.review.inProgress),
    ).toBeInTheDocument();
    expect(screen.getByTestId("paper-review-cancel")).toHaveTextContent(
      enCommon.actions.cancel,
    );

    pending.release?.();
    await waitFor(() =>
      expect(screen.queryByTestId("paper-review-cancel")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("paper-review-error")).not.toBeInTheDocument();
  });

  it("re-checks the provider when the AI config change event fires", async () => {
    await renderReady();
    hasConfiguredProvider.mockReturnValue(false);
    window.dispatchEvent(
      new CustomEvent("oleafly:ai-config-changed", {
        detail: { providers: {} },
      }),
    );
    expect(
      await screen.findByText(enResearchTools.review.needsProvider),
    ).toBeInTheDocument();
  });
});
