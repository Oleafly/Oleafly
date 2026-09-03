// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { useTourStore } from "@/store/tours";

const pdfStub = vi.hoisted(() => ({
  fits: { width: 1.75, height: 0.6 } as Record<"width" | "height", number | null>,
  getFitScale: vi.fn(),
  scales: [] as number[],
}));

vi.mock("@/components/pdf/PdfViewer", async () => {
  const react = await import("react");
  interface StubProps {
    scale: number;
    documentIdentity: string;
    onPageChange?: (page: number, total: number) => void;
  }
  const PdfViewer = react.forwardRef<unknown, StubProps>((props, ref) => {
    react.useImperativeHandle(
      ref,
      () => ({ getFitScale: pdfStub.getFitScale }),
      [],
    );
    react.useEffect(() => {
      pdfStub.scales.push(props.scale);
    }, [props.scale]);
    const announce = react.useRef(props.onPageChange);
    announce.current = props.onPageChange;
    react.useEffect(() => {
      announce.current?.(1, 3);
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
vi.mock("@/lib/preview-window", () => ({
  openPreviewWindow: vi.fn(),
}));

import { PreviewPane } from "./PreviewPane";
import { sessionZoomByProject } from "./preview-zoom";

describe("PreviewPane empty state", () => {
  const recompile = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    recompile.mockClear();
    useCompileStore.setState({
      status: "idle",
      phase: "idle",
      log: "",
      errors: [],
      pdfBytes: null,
      lastAttemptIdentity: null,
      lastCompileCheckpoint: null,
      failureReason: null,
      compileTimeMs: null,
      recompile,
    } as unknown as ReturnType<typeof useCompileStore.getState>);
    useFilesStore.setState({
      projectId: "preview-empty-fixture",
      projectName: "Preview empty fixture",
      projectKind: "",
      mainDoc: "main.tex",
      engineLoaded: true,
      refreshTree: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    useTourStore.setState({ activeTourId: null });
    useProjectAnalysisStore.getState().activateProject({
      projectId: "preview-empty-fixture",
      projectRevision: 2,
      languageServiceGeneration: 0,
    });
  });

  it("shows the startup state without a duplicate compile button", () => {
    render(<PreviewPane />);
    expect(screen.getByRole("status", { name: /Document startup/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compile now" })).not.toBeInTheDocument();
    expect(recompile).not.toHaveBeenCalled();
  });

  it("reports the language service and its analysis as one startup stage", () => {
    render(<PreviewPane />);
    // Separate rows let analysis show "complete" above a service that is still
    // starting, which reads as an out-of-order checklist.
    expect(screen.queryByText("Language service")).not.toBeInTheDocument();
    expect(screen.getByText("Language analysis")).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: /Document startup: \d+ of 3 stages/ }),
    ).toBeInTheDocument();
  });

  it("never mounts unverified bytes from an older project revision", () => {
    useCompileStore.setState({
      status: "success",
      pdfBytes: new Uint8Array([1, 2, 3]),
      lastCompileCheckpoint: {
        version: 1,
        projectId: "preview-empty-fixture",
        mainDocument: "main.tex",
        projectRevision: 1,
        requestGeneration: 1,
        outputKind: "standard",
        producerId: "test",
        outputRevision: 1,
        outputId: "pdf-v1:3:0000000000000000",
        completedAt: 1,
      },
    });

    render(<PreviewPane />);
    expect(
      screen.queryByTestId("mock-pdf-viewer"),
    ).not.toBeInTheDocument();
  });
});

describe("PreviewPane zoom", () => {
  function openProject(projectId: string, revision: number, byte: number) {
    useProjectAnalysisStore.getState().activateProject({
      projectId,
      projectRevision: revision,
      languageServiceGeneration: 0,
    });
    useFilesStore.setState({
      projectId,
      projectName: projectId,
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
      compileTimeMs: null,
      lastAttemptIdentity: null,
      pdfBytes: new Uint8Array([byte, byte, byte]),
      lastCompileCheckpoint: {
        version: 1,
        projectId,
        mainDocument: "main.tex",
        projectRevision: revision,
        requestGeneration: 1,
        outputKind: "standard",
        producerId: "test",
        outputRevision: 1,
        outputId: `pdf-v1:3:${projectId}`,
        completedAt: 1,
      },
      recompile: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useCompileStore.getState>);
  }

  const lastScale = () => pdfStub.scales.at(-1);

  beforeEach(() => {
    pdfStub.fits = { width: 1.75, height: 0.6 };
    pdfStub.getFitScale.mockClear();
    pdfStub.getFitScale.mockImplementation(
      (mode: "width" | "height") => pdfStub.fits[mode],
    );
    pdfStub.scales.length = 0;
    sessionZoomByProject.clear();
    useTourStore.setState({ activeTourId: null });
  });

  it("opens a project fit to width rather than at one hundred percent", async () => {
    openProject("zoom-fixture", 2, 1);
    render(<PreviewPane />);

    await screen.findByTestId("mock-pdf-viewer");
    await waitFor(() => expect(lastScale()).toBe(1.75));
    expect(pdfStub.getFitScale).toHaveBeenCalledWith("width");
    expect(pdfStub.getFitScale).not.toHaveBeenCalledWith("height");
  });

  it("leaves a zoom the user set alone once the fit has run", async () => {
    openProject("zoom-fixture", 2, 1);
    render(<PreviewPane />);
    await waitFor(() => expect(lastScale()).toBe(1.75));

    fireEvent.keyDown(screen.getByTestId("preview-pane"), {
      key: "=",
      metaKey: true,
    });
    await waitFor(() => expect(lastScale()).toBeCloseTo(1.95));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(lastScale()).toBeCloseTo(1.95);
  });

  it("restores the zoom the user set for a project it reopens", async () => {
    openProject("zoom-a", 2, 1);
    render(<PreviewPane />);
    await waitFor(() => expect(lastScale()).toBe(1.75));
    fireEvent.keyDown(screen.getByTestId("preview-pane"), {
      key: "=",
      metaKey: true,
    });
    await waitFor(() => expect(lastScale()).toBeCloseTo(1.95));

    act(() => openProject("zoom-b", 3, 2));
    await waitFor(() => expect(lastScale()).toBe(1.75));

    act(() => openProject("zoom-a", 2, 3));
    await waitFor(() => expect(lastScale()).toBeCloseTo(1.95));
  });

  it("keeps the zoom the user set when the pane unmounts and mounts again", async () => {
    openProject("zoom-remount", 2, 1);
    const first = render(<PreviewPane />);
    await waitFor(() => expect(lastScale()).toBe(1.75));
    fireEvent.keyDown(screen.getByTestId("preview-pane"), {
      key: "=",
      metaKey: true,
    });
    await waitFor(() => expect(lastScale()).toBeCloseTo(1.95));

    first.unmount();
    pdfStub.scales.length = 0;
    render(<PreviewPane />);
    await screen.findByTestId("mock-pdf-viewer");
    await waitFor(() => expect(lastScale()).toBeCloseTo(1.95));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(lastScale()).toBeCloseTo(1.95);
  });

  it("replays a remembered fit mode rather than the number it produced", async () => {
    sessionZoomByProject.set("zoom-fit", { scale: 0.6, fitMode: "height" });
    openProject("zoom-fit", 2, 1);
    pdfStub.fits.height = 0.9;
    const first = render(<PreviewPane />);
    await waitFor(() => expect(lastScale()).toBe(0.9));
    expect(pdfStub.getFitScale).toHaveBeenCalledWith("height");
    expect(pdfStub.getFitScale).not.toHaveBeenCalledWith("width");

    first.unmount();
    pdfStub.scales.length = 0;
    pdfStub.fits.height = 1.2;
    render(<PreviewPane />);
    await waitFor(() => expect(lastScale()).toBe(1.2));
  });

  it("retries the fit on the next render when the page cannot be measured yet", async () => {
    pdfStub.fits.width = null;
    openProject("zoom-unmeasurable", 2, 1);
    render(<PreviewPane />);
    await waitFor(() => expect(pdfStub.getFitScale).toHaveBeenCalledWith("width"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(lastScale()).toBe(1);

    pdfStub.fits.width = 1.75;
    act(() => openProject("zoom-unmeasurable", 3, 2));
    await waitFor(() => expect(lastScale()).toBe(1.75));
  });
});
