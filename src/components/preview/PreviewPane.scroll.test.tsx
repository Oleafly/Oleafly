// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { usePdfViewStore } from "@/store/pdf-view";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { useTourStore } from "@/store/tours";

const viewerStub = vi.hoisted(() => ({
  gotoPage: vi.fn(),
  holdReady: false,
  finish: null as (() => void) | null,
  fitScale: 1,
}));

vi.mock("@/components/pdf/PdfViewer", async () => {
  const react = await import("react");
  interface StubProps {
    documentIdentity: string;
    rotation?: number;
    scale?: number;
    onPageChange?: (page: number, total: number) => void;
    onLoadStateChange?: (state: Record<string, unknown>) => void;
  }
  const PdfViewer = react.forwardRef<unknown, StubProps>((props, ref) => {
    react.useImperativeHandle(
      ref,
      () => ({
        getFitScale: () => viewerStub.fitScale,
        gotoPage: viewerStub.gotoPage,
        activateOutlineItem: vi.fn(),
        findNext: vi.fn(),
        findPrevious: vi.fn(),
      }),
      [],
    );
    const latest = react.useRef(props);
    latest.current = props;
    react.useEffect(() => {
      latest.current.onLoadStateChange?.({
        status: "loading",
        documentIdentity: props.documentIdentity,
      });
      const finish = () => {
        latest.current.onPageChange?.(4, 9);
        latest.current.onLoadStateChange?.({
          status: "ready",
          documentIdentity: props.documentIdentity,
        });
      };
      if (viewerStub.holdReady) viewerStub.finish = finish;
      else finish();
    }, [props.documentIdentity, props.rotation]);
    return (
      <div
        data-testid="mock-pdf-viewer"
        data-identity={props.documentIdentity}
        data-scale={props.scale}
        style={{ height: 4000 }}
      />
    );
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
vi.mock("@/lib/preview-window", () => ({ openPreviewWindow: vi.fn() }));
vi.mock("@/components/ui/toolbar-overflow", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAvailableWidth: () => ({
    containerRef: () => {},
    availableWidth: Number.POSITIVE_INFINITY,
  }),
}));

import { PreviewPane } from "./PreviewPane";

const PROJECT = "scroll-fixture";

function compileOutput(outputRevision: number) {
  const bytes = new Uint8Array([outputRevision, 2, 3]);
  useCompileStore.setState({
    status: "success",
    phase: "idle",
    log: "",
    errors: [],
    failureReason: null,
    compileTimeMs: 120,
    lastAttemptIdentity: null,
    pdfBytes: bytes,
    lastCompileCheckpoint: {
      version: 1,
      projectId: PROJECT,
      mainDocument: "main.tex",
      projectRevision: 2,
      requestGeneration: outputRevision,
      outputKind: "standard",
      producerId: "test",
      outputRevision,
      outputId: `pdf-v1:3:${PROJECT}:${outputRevision}`,
      completedAt: outputRevision,
    },
    recompile: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useCompileStore.getState>);
}

function openProject() {
  useProjectAnalysisStore.getState().activateProject({
    projectId: PROJECT,
    projectRevision: 2,
    languageServiceGeneration: 0,
  });
  useFilesStore.setState({
    projectId: PROJECT,
    projectName: "Scroll fixture",
    projectKind: "",
    mainDoc: "main.tex",
    engineLoaded: true,
    refreshTree: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  compileOutput(1);
}

function scrollArea(): HTMLElement {
  const area = document.querySelector<HTMLElement>("[data-pdf-scroll-root]");
  if (!area) throw new Error("PDF scroll area is missing");
  return area;
}

beforeEach(() => {
  viewerStub.gotoPage.mockClear();
  viewerStub.holdReady = false;
  viewerStub.finish = null;
  viewerStub.fitScale = 1;
  useTourStore.setState({ activeTourId: null });
  usePdfViewStore.setState({ page: 1 });
  localStorage.clear();
});

describe("PreviewPane PDF scroll area", () => {
  it("draws its own scrollbars over the PDF and hides the native ones", async () => {
    openProject();
    render(<PreviewPane />);
    await screen.findByTestId("mock-pdf-viewer");
    const area = scrollArea();
    expect(area).toHaveClass("ofl-native-scrollbar-hidden");
    const host = area.parentElement as HTMLElement;
    expect(host.querySelector(":scope > [data-overlay-scrollbar='y']")).not.toBeNull();
    expect(host.querySelector(":scope > [data-overlay-scrollbar='x']")).not.toBeNull();
  });

  it("scopes select-all to the PDF text", async () => {
    openProject();
    render(<PreviewPane />);
    await screen.findByTestId("mock-pdf-viewer");
    expect(scrollArea()).toHaveAttribute("data-select-all-scope");
    expect(scrollArea()).not.toHaveClass("select-text");
  });

  it("keeps the reader's place when a recompile replaces the PDF", async () => {
    openProject();
    render(<PreviewPane />);
    await screen.findByTestId("mock-pdf-viewer");
    await waitFor(() => expect(viewerStub.gotoPage).toHaveBeenCalledTimes(1));
    const area = scrollArea();
    area.scrollTop = 2_345;
    area.scrollLeft = 12;
    viewerStub.gotoPage.mockClear();

    act(() => compileOutput(2));

    await waitFor(() =>
      expect(document.querySelector("[data-testid='mock-pdf-viewer']")).not.toBeNull(),
    );
    await act(() => Promise.resolve());
    expect(viewerStub.gotoPage).not.toHaveBeenCalled();
    expect(area.scrollTop).toBe(2_345);
    expect(area.scrollLeft).toBe(12);
  });

  it("returns to the reader's page instead of a stale offset after a rotation", async () => {
    openProject();
    render(<PreviewPane />);
    await screen.findByTestId("mock-pdf-viewer");
    await waitFor(() => expect(viewerStub.gotoPage).toHaveBeenCalledTimes(1));
    scrollArea().scrollTop = 2_345;
    viewerStub.gotoPage.mockClear();

    fireEvent.click(screen.getByRole("button", { name: enPreview.actions.rotate }));

    await waitFor(() => expect(viewerStub.gotoPage).toHaveBeenCalledTimes(1));
  });

  it("returns to the reader's page after a rotation from the keyboard", async () => {
    openProject();
    render(<PreviewPane />);
    await screen.findByTestId("mock-pdf-viewer");
    await waitFor(() => expect(viewerStub.gotoPage).toHaveBeenCalledTimes(1));
    scrollArea().scrollTop = 2_345;
    viewerStub.gotoPage.mockClear();

    fireEvent.keyDown(scrollArea(), { key: "R", metaKey: true, shiftKey: true });

    await waitFor(() => expect(viewerStub.gotoPage).toHaveBeenCalledTimes(1));
  });

  it("keeps the page controls in place while a recompile loads", async () => {
    openProject();
    render(<PreviewPane />);
    await screen.findByTestId("mock-pdf-viewer");
    await waitFor(() =>
      expect(screen.getByText(enPreview.pages.ofTotal.replace("{{total}}", "9"))).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(enPreview.pages.number)).toHaveValue("4");

    viewerStub.holdReady = true;
    act(() => compileOutput(2));
    await waitFor(() => expect(viewerStub.finish).not.toBeNull());

    expect(screen.getByText(enPreview.pages.ofTotal.replace("{{total}}", "9"))).toBeInTheDocument();
    expect(screen.getByLabelText(enPreview.pages.number)).toHaveValue("4");
    act(() => viewerStub.finish?.());
    expect(screen.getByLabelText(enPreview.pages.number)).toHaveValue("4");
  });
});

describe("PreviewPane while the layout hides it", () => {
  const resizeCallbacks = new Set<ResizeObserverCallback>();

  beforeEach(() => {
    resizeCallbacks.clear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private readonly callback: ResizeObserverCallback;
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
        }
        observe() {
          resizeCallbacks.add(this.callback);
        }
        unobserve() {}
        disconnect() {
          resizeCallbacks.delete(this.callback);
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function resizeEverything() {
    await act(async () => {
      for (const callback of [...resizeCallbacks]) {
        callback([], {} as ResizeObserver);
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
  }

  it("shows the compiled PDF when React mounts it twice in development", async () => {
    openProject();
    render(
      <StrictMode>
        <PreviewPane />
      </StrictMode>,
    );

    const viewer = await screen.findByTestId("mock-pdf-viewer");
    expect(viewer.dataset.identity).toContain(PROJECT);
  });

  it("keeps the PDF it shows until it is visible again, then shows the newest one", async () => {
    openProject();
    const view = render(<PreviewPane />);
    const first = (await screen.findByTestId("mock-pdf-viewer")).dataset.identity;

    view.rerender(<PreviewPane active={false} />);
    act(() => compileOutput(2));
    await act(() => Promise.resolve());
    expect(screen.getByTestId("mock-pdf-viewer").dataset.identity).toBe(first);

    view.rerender(<PreviewPane active />);
    await waitFor(() =>
      expect(screen.getByTestId("mock-pdf-viewer").dataset.identity).not.toBe(first),
    );
  });

  it("does not fit the PDF to a pane it cannot see", async () => {
    openProject();
    const view = render(<PreviewPane />);
    await screen.findByTestId("mock-pdf-viewer");
    const shownScale = () => screen.getByTestId("mock-pdf-viewer").dataset.scale;
    await resizeEverything();
    expect(shownScale()).toBe("1");

    view.rerender(<PreviewPane active={false} />);
    viewerStub.fitScale = 1.5;
    await resizeEverything();
    expect(shownScale()).toBe("1");

    view.rerender(<PreviewPane active />);
    await resizeEverything();
    expect(shownScale()).toBe("1.5");
  });
});
