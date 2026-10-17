// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { usePdfViewStore } from "@/store/pdf-view";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { useTourStore } from "@/store/tours";
import { useZenStore } from "@/store/zen";
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
const openPreviewWindow = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}));
const logError = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}));
vi.mock("@/lib/log", () => ({ logError }));
const toolbarMeasurement = vi.hoisted(() => ({ width: Number.POSITIVE_INFINITY }));
vi.mock("@/lib/preview-window", () => ({ openPreviewWindow }));
vi.mock("@/components/ui/toolbar-overflow", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAvailableWidth: () => ({
    containerRef: () => {},
    availableWidth: toolbarMeasurement.width,
  }),
}));

import { PreviewPane } from "./PreviewPane";
import { sessionZoomByProject } from "./preview-zoom";

const PROJECT = "toolbar-fixture";


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


function beginZen() {
  act(() => {
    useZenStore.getState().begin({
      projectId: PROJECT,
      snapshot: {
        showTree: true,
        railTab: "files",
        assistantOpen: false,
        workspaceHidden: false,
        viewMode: "split",
        terminalOpen: false,
      },
      pdfVisibleAtStart: true,
      fullscreen: "none",
    });
  });
}

beforeEach(() => {
  toolbarMeasurement.width = Number.POSITIVE_INFINITY;
  viewerStub.loadStatus = "ready";
  viewerStub.outlineItems = [];
  viewerStub.pages = 3;
  sessionZoomByProject.clear();
  useTourStore.setState({ activeTourId: null });
  usePdfViewStore.setState({ page: 1 });
  useZenStore.getState().end();
});

describe("PreviewPane in Zen mode", () => {
  it("hides the PDF toolbar and keeps the document", async () => {
    openProject();
    render(<PreviewPane />);
    await screen.findByTestId("mock-pdf-viewer");
    expect(await screen.findByRole("button", { name: enPreview.toolbar.showLogs })).toBeInTheDocument();
    expect(screen.getByLabelText(enPreview.zoom.in)).toBeInTheDocument();

    beginZen();

    expect(screen.queryByRole("button", { name: enPreview.toolbar.showLogs })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(enPreview.zoom.in)).not.toBeInTheDocument();
    expect(screen.getByTestId("mock-pdf-viewer")).toBeInTheDocument();
  });

  it("brings the toolbar back when Zen mode ends", async () => {
    openProject();
    render(<PreviewPane />);
    await screen.findByTestId("mock-pdf-viewer");
    beginZen();
    act(() => useZenStore.getState().end());
    expect(await screen.findByLabelText(enPreview.zoom.in)).toBeInTheDocument();
  });

  it("shows the compile log when the failed-compile pill asks for it, and the PDF again when it is closed", async () => {
    openProject();
    render(<PreviewPane />);
    await screen.findByTestId("mock-pdf-viewer");
    beginZen();
    expect(screen.queryByTestId("mock-log-pane")).not.toBeInTheDocument();

    act(() => useZenStore.getState().setLogsOpen(true));
    expect(screen.getByTestId("mock-log-pane")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-pdf-viewer")).not.toBeInTheDocument();

    act(() => useZenStore.getState().setLogsOpen(false));
    expect(screen.queryByTestId("mock-log-pane")).not.toBeInTheDocument();
    expect(await screen.findByTestId("mock-pdf-viewer")).toBeInTheDocument();
  });

  it("shows the log when it was asked for before the pane existed", async () => {
    beginZen();
    act(() => useZenStore.getState().setLogsOpen(true));
    openProject();
    useCompileStore.setState({ status: "error" });
    render(<PreviewPane />);
    expect(await screen.findByTestId("mock-log-pane")).toBeInTheDocument();
  });

  it("goes back to the PDF when Zen mode ends with the log open", async () => {
    openProject();
    render(<PreviewPane />);
    await screen.findByTestId("mock-pdf-viewer");
    beginZen();
    act(() => useZenStore.getState().setLogsOpen(true));
    act(() => useZenStore.getState().end());
    expect(await screen.findByTestId("mock-pdf-viewer")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-log-pane")).not.toBeInTheDocument();
  });

  it("leaves a log the writer opened with the toolbar alone outside Zen mode", async () => {
    openProject();
    render(<PreviewPane />);
    await screen.findByTestId("mock-pdf-viewer");
    await userEvent.setup().click(await screen.findByRole("button", { name: enPreview.toolbar.showLogs }));
    expect(screen.getByTestId("mock-log-pane")).toBeInTheDocument();
    act(() => useZenStore.getState().setLogsOpen(false));
    expect(screen.getByTestId("mock-log-pane")).toBeInTheDocument();
  });
});
