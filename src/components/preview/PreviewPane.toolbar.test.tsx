// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { usePdfViewStore } from "@/store/pdf-view";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { useTourStore } from "@/store/tours";
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };

const viewerStub = vi.hoisted(() => ({
  loadStatus: "ready" as string,
  outlineItems: [] as unknown[],
  pages: 3,
  activateOutlineItem: vi.fn(),
  gotoPage: vi.fn(),
  scrollToPage: vi.fn(),
  findNext: vi.fn(),
  findPrevious: vi.fn(),
  lastProps: null as Record<string, unknown> | null,
}));

vi.mock("@/components/pdf/PdfViewer", async () => {
  const react = await import("react");
  interface StubProps {
    documentIdentity: string;
    scale: number;
    onPageChange?: (page: number, total: number) => void;
    onLoadStateChange?: (state: Record<string, unknown>) => void;
    onOutlineStateChange?: (state: Record<string, unknown>) => void;
    onSearchStateChange?: (state: Record<string, unknown>) => void;
  }
  const PdfViewer = react.forwardRef<unknown, StubProps>((props, ref) => {
    viewerStub.lastProps = props as unknown as Record<string, unknown>;
    react.useImperativeHandle(
      ref,
      () => ({
        getFitScale: () => 1.5,
        activateOutlineItem: viewerStub.activateOutlineItem,
        gotoPage: viewerStub.gotoPage,
        scrollToPage: viewerStub.scrollToPage,
        findNext: viewerStub.findNext,
        findPrevious: viewerStub.findPrevious,
      }),
      [],
    );
    const announce = react.useRef(props);
    announce.current = props;
    react.useEffect(() => {
      announce.current.onPageChange?.(1, viewerStub.pages);
      announce.current.onLoadStateChange?.({
        status: viewerStub.loadStatus,
        documentIdentity: props.documentIdentity,
      });
      announce.current.onOutlineStateChange?.({
        status: "ready",
        items: viewerStub.outlineItems,
      });
    }, [props.documentIdentity]);
    return <div data-testid="mock-pdf-viewer" />;
  });
  return { PdfViewer };
});
vi.mock("@/components/editor/LogPane", () => ({
  LogPane: () => <div data-testid="mock-log-pane" />,
}));
vi.mock("@/features/synctex", () => ({
  canUseSyncTexForCheckpoint: vi.fn(() => false),
  inverseFromClick: vi.fn(),
}));
vi.mock("@/features/ask-ai-compile-errors", () => ({
  askAiAboutCompileErrors: vi.fn(),
}));
const openPreviewWindow = vi.hoisted(() => vi.fn());
vi.mock("@/lib/preview-window", () => ({ openPreviewWindow }));
vi.mock("@/components/ui/toolbar-overflow", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAvailableWidth: () => ({
    containerRef: () => {},
    availableWidth: Number.POSITIVE_INFINITY,
  }),
}));

import { PreviewPane } from "./PreviewPane";
import { sessionZoomByProject } from "./preview-zoom";

const PROJECT = "toolbar-fixture";

const zoomTriggerName = (percent: number) =>
  enPreview.zoom.percentLabel.replace("{{percent}}", String(percent));

function openProject(revision = 2) {
  useProjectAnalysisStore.getState().activateProject({
    projectId: PROJECT,
    projectRevision: revision,
    languageServiceGeneration: 0,
  });
  useFilesStore.setState({
    projectId: PROJECT,
    projectName: "Toolbar fixture",
    projectKind: "",
    mainDoc: "main.tex",
    engineLoaded: true,
    refreshTree: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useCompileStore.setState({
    status: "success",
    phase: "idle",
    log: "",
    errors: [],
    failureReason: null,
    compileTimeMs: 120,
    lastAttemptIdentity: null,
    pdfBytes: new Uint8Array([1, 2, 3]),
    lastCompileCheckpoint: {
      version: 1,
      projectId: PROJECT,
      mainDocument: "main.tex",
      projectRevision: revision,
      requestGeneration: 1,
      outputKind: "standard",
      producerId: "test",
      outputRevision: 1,
      outputId: `pdf-v1:3:${PROJECT}`,
      completedAt: 1,
    },
    recompile: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useCompileStore.getState>);
}

async function renderWithPdf() {
  openProject();
  const view = render(<PreviewPane />);
  await screen.findByTestId("mock-pdf-viewer");
  await waitFor(() =>
    expect(screen.getByLabelText(zoomTriggerName(150))).toBeInTheDocument(),
  );
  return view;
}

beforeEach(() => {
  viewerStub.loadStatus = "ready";
  viewerStub.outlineItems = [];
  viewerStub.pages = 3;
  viewerStub.activateOutlineItem.mockClear();
  viewerStub.gotoPage.mockClear();
  openPreviewWindow.mockClear();
  sessionZoomByProject.clear();
  useTourStore.setState({ activeTourId: null });
  usePdfViewStore.setState({ page: 1 });
});

describe("PreviewPane toolbar", () => {
  it("lays out every control with a resolved label", async () => {
    await renderWithPdf();
    for (const label of [
      enPreview.zoom.in,
      enPreview.zoom.out,
      enPreview.pageLayout.group,
      enPreview.pageLayout.single,
      enPreview.pageLayout.double,
      enPreview.actions.invert,
      enPreview.actions.readerView,
      enPreview.actions.rotate,
      enPreview.actions.savePdf,
      enPreview.outline.open,
      enPreview.search.open,
      enPreview.pages.previous,
      enPreview.pages.next,
      enPreview.pages.number,
    ]) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument();
    }
    expect(
      screen.getByText(enPreview.pages.ofTotal.replace("{{total}}", "3")),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(zoomTriggerName(150))).toBeInTheDocument();
  });

  it("zooms in and out from the toolbar buttons", async () => {
    await renderWithPdf();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(enPreview.zoom.in));
    await waitFor(() =>
      expect(screen.getByLabelText(zoomTriggerName(170))).toBeInTheDocument(),
    );
    await user.click(screen.getByLabelText(enPreview.zoom.out));
    await waitFor(() =>
      expect(screen.getByLabelText(zoomTriggerName(150))).toBeInTheDocument(),
    );
  });

  it("offers every zoom choice in the zoom menu", async () => {
    await renderWithPdf();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(zoomTriggerName(150)));
    const menu = await screen.findByRole("menu");
    for (const label of [
      enPreview.zoom.in,
      enPreview.zoom.out,
      enPreview.zoom.fitToWidth,
      enPreview.zoom.fitToHeight,
      enPreview.zoom.reset,
    ]) {
      expect(within(menu).getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
    await user.click(
      within(menu).getByRole("menuitem", { name: enPreview.zoom.reset }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText(zoomTriggerName(100))).toBeInTheDocument(),
    );
  });

  it("switches the page layout and keeps the radios in sync", async () => {
    await renderWithPdf();
    const user = userEvent.setup();
    const double = screen.getByLabelText(enPreview.pageLayout.double);
    expect(double).toHaveAttribute("aria-checked", "false");
    await user.click(double);
    await waitFor(() =>
      expect(screen.getByLabelText(enPreview.pageLayout.double)).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
  });

  it("presses the invert and reader toggles", async () => {
    await renderWithPdf();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(enPreview.actions.invert));
    await waitFor(() =>
      expect(screen.getByLabelText(enPreview.actions.invert)).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    await user.click(screen.getByLabelText(enPreview.actions.readerView));
    await waitFor(() =>
      expect(screen.getByLabelText(enPreview.actions.readerView)).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  it("passes the new rotation to the viewer", async () => {
    await renderWithPdf();
    const user = userEvent.setup();
    expect(viewerStub.lastProps?.rotation).toBe(0);
    await user.click(screen.getByLabelText(enPreview.actions.rotate));
    await waitFor(() => expect(viewerStub.lastProps?.rotation).toBe(90));
  });

  it("opens and closes the search panel", async () => {
    await renderWithPdf();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(enPreview.search.open));
    const input = await screen.findByLabelText(enPreview.search.input);
    await user.type(input, "alpha");
    expect(input).toHaveValue("alpha");
    expect(screen.getByLabelText(enPreview.search.next)).toBeInTheDocument();
    expect(screen.getByLabelText(enPreview.search.previous)).toBeInTheDocument();
    await user.click(screen.getByLabelText(enPreview.search.close));
    await waitFor(() =>
      expect(screen.queryByLabelText(enPreview.search.input)).not.toBeInTheDocument(),
    );
  });

  it("says an outline is empty when the PDF has none", async () => {
    await renderWithPdf();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(enPreview.outline.open));
    expect(await screen.findByText(enPreview.outline.empty)).toBeInTheDocument();
    expect(screen.getByLabelText(enPreview.outline.panel)).toBeInTheDocument();
    expect(screen.getByLabelText(enPreview.outline.open)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const close = screen.getAllByRole("button", { name: enPreview.outline.close });
    await user.click(close[0]);
    await waitFor(() =>
      expect(screen.getByLabelText(enPreview.outline.open)).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
  });

  it("activates an outline entry the reader picks", async () => {
    viewerStub.outlineItems = [
      { id: "sec-1", title: "Method", external: false, children: [] },
    ];
    await renderWithPdf();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(enPreview.outline.open));
    await user.click(await screen.findByRole("button", { name: "Method" }));
    expect(viewerStub.activateOutlineItem).toHaveBeenCalledWith("sec-1");
  });

  it("opens the save dialog with a name derived from the main document", async () => {
    await renderWithPdf();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(enPreview.actions.savePdf));
    const name = await screen.findByLabelText(enPreview.save.nameLabel);
    expect(name).toHaveValue("main.pdf");
    expect(screen.getByText(enPreview.save.description)).toBeInTheDocument();
    await user.click(
      screen.getAllByRole("button", { name: enPreview.save.close })[0],
    );
    await waitFor(() =>
      expect(screen.queryByLabelText(enPreview.save.nameLabel)).not.toBeInTheDocument(),
    );
  });

  it("hands the current compile state to a new preview window", async () => {
    await renderWithPdf();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(enPreview.actions.openWindow));
    expect(openPreviewWindow).toHaveBeenCalledTimes(1);
  });

  it("steps through the pages from the toolbar", async () => {
    await renderWithPdf();
    const user = userEvent.setup();
    expect(screen.getByLabelText(enPreview.pages.previous)).toBeDisabled();
    await user.click(screen.getByLabelText(enPreview.pages.next));
    expect(viewerStub.gotoPage).toHaveBeenCalledWith(2);
    const number = screen.getByLabelText(enPreview.pages.number);
    await user.clear(number);
    await user.type(number, "3");
    await user.tab();
    expect(viewerStub.gotoPage).toHaveBeenLastCalledWith(3);
  });

  it("explains a failed load and offers a retry", async () => {
    viewerStub.loadStatus = "invalid";
    openProject();
    render(<PreviewPane />);
    expect(await screen.findByText(enPreview.viewer.invalidTitle)).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: enPreview.viewer.retry });
    await act(async () => {
      retry.click();
    });
  });

  it("asks for the password of a locked PDF", async () => {
    viewerStub.loadStatus = "password_required";
    openProject();
    render(<PreviewPane />);
    expect(await screen.findByText(enPreview.password.title)).toBeInTheDocument();
    expect(screen.getByLabelText(enPreview.password.label)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: enPreview.password.submit }),
    ).toBeInTheDocument();
  });
});
