// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { projectFilesystemEpoch } from "@/store/project-index";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  tauri: { enabled: true },
  toast: {
    success: vi.fn(),
    successUnique: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
  notifyError: vi.fn(),
  logError: vi.fn(),
  pickSavePath: vi.fn(),
  writeBytesFile: vi.fn(),
  saveFileBase64: vi.fn(),
  revealInDir: vi.fn(),
  pdfPageToPng: vi.fn(async () => "data:image/png;base64,aGk="),
  downloadBytes: vi.fn(),
  present: vi.fn(async () => {}),
  askAi: vi.fn(),
  inverseFromClick: vi.fn(),
  syncTex: { available: false },
  gotoPage: vi.fn(),
  viewer: null as null | {
    documentIdentity: string;
    password?: string;
    onLoadStateChange?: (state: Record<string, unknown>) => void;
    onSearchStateChange?: (state: Record<string, unknown>) => void;
    onInverse?: (page: number, x: number, y: number, word: string) => void;
  },
  firstLoad: "ready" as string,
  pages: 3,
  viewerRenders: 0,
}));

vi.mock("@/components/pdf/PdfViewer", async () => {
  const react = await import("react");
  interface StubProps {
    documentIdentity: string;
    password?: string;
    onPageChange?: (page: number, total: number) => void;
    onLoadStateChange?: (state: Record<string, unknown>) => void;
    onOutlineStateChange?: (state: Record<string, unknown>) => void;
  }
  const PdfViewer = react.forwardRef<unknown, StubProps>((props, ref) => {
    mocks.viewer = props as typeof mocks.viewer;
    mocks.viewerRenders++;
    react.useImperativeHandle(
      ref,
      () => ({
        getFitScale: () => 1.5,
        activateOutlineItem: vi.fn(),
        gotoPage: mocks.gotoPage,
        scrollToPage: vi.fn(),
        findNext: vi.fn(),
        findPrevious: vi.fn(),
      }),
      [],
    );
    const announce = react.useRef(props);
    announce.current = props;
    react.useEffect(() => {
      announce.current.onPageChange?.(1, mocks.pages);
      announce.current.onLoadStateChange?.({ status: mocks.firstLoad, documentIdentity: props.documentIdentity });
      announce.current.onOutlineStateChange?.({ status: "ready", items: [] });
    }, [props.documentIdentity]);
    return <div data-testid="mock-pdf-viewer" />;
  });
  return { PdfViewer };
});
vi.mock("@/components/editor/LogPane", () => ({ LogPane: () => <div data-testid="mock-log-pane" /> }));
vi.mock("@/features/synctex", () => ({
  canUseSyncTexForCheckpoint: () => mocks.syncTex.available,
  inverseFromClick: mocks.inverseFromClick,
}));
vi.mock("@/features/ask-ai-compile-errors", () => ({ askAiAboutCompileErrors: mocks.askAi }));
vi.mock("@/features/presentation/launch", () => ({ present: mocks.present }));
vi.mock("@/lib/preview-window", () => ({ openPreviewWindow: vi.fn(async () => {}) }));
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng: mocks.pdfPageToPng }));
vi.mock("@/lib/download-blob", () => ({ downloadBytes: mocks.downloadBytes }));
vi.mock("@/components/ui/toolbar-overflow", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAvailableWidth: () => ({ containerRef: () => {}, availableWidth: Number.POSITIVE_INFINITY }),
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => mocks.tauri.enabled,
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  revealInDir: mocks.revealInDir,
  saveFileBase64: mocks.saveFileBase64,
  writeBytesFile: mocks.writeBytesFile,
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: mocks.pickSavePath }));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast, notifyError: mocks.notifyError }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { PreviewPane } from "./PreviewPane";
import { sessionZoomByProject } from "./preview-zoom";

const PROJECT = "actions-fixture";

function checkpoint(revision: number, outputRevision = 1) {
  return {
    version: 1,
    projectId: PROJECT,
    mainDocument: "main.tex",
    projectRevision: revision,
    requestGeneration: outputRevision,
    outputKind: "standard",
    producerId: "test",
    outputRevision,
    outputId: `pdf-v1:${outputRevision}:${PROJECT}`,
    completedAt: outputRevision,
  };
}

function activate(revision: number) {
  useProjectAnalysisStore.getState().activateProject({
    projectId: PROJECT,
    projectRevision: revision,
    languageServiceGeneration: 0,
  });
}

function openProject(overrides: Record<string, unknown> = {}) {
  activate(2);
  useFilesStore.setState({
    projectId: PROJECT,
    projectName: "Actions fixture",
    projectKind: "",
    mainDoc: "main.tex",
    engineLoaded: true,
    refreshTree: vi.fn().mockResolvedValue(undefined),
    ...overrides,
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
    lastCompileCheckpoint: checkpoint(2),
    recompile: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useCompileStore.getState>);
}

async function renderPane(overrides: Record<string, unknown> = {}) {
  openProject(overrides);
  const view = render(<PreviewPane />);
  await screen.findByTestId("mock-pdf-viewer");
  return view;
}

function loadState(status: string, extra: Record<string, unknown> = {}) {
  act(() => mocks.viewer?.onLoadStateChange?.({ status, documentIdentity: mocks.viewer.documentIdentity, ...extra }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tauri.enabled = true;
  mocks.syncTex.available = false;
  mocks.firstLoad = "ready";
  mocks.pages = 3;
  mocks.viewer = null;
  mocks.pdfPageToPng.mockResolvedValue("data:image/png;base64,aGk=");
  mocks.pickSavePath.mockResolvedValue("/Users/me/Downloads/figure.png");
  mocks.writeBytesFile.mockResolvedValue(undefined);
  mocks.saveFileBase64.mockResolvedValue(undefined);
  sessionZoomByProject.clear();
  useTourStore.setState({ activeTourId: null });
  useSettingsStore.setState({ viewMode: "split" });
});

describe("PreviewPane image projects", () => {
  it("saves the figure into the project as a PNG", async () => {
    await renderPane({ projectKind: "image", projectName: "My figure!" });
    const user = userEvent.setup();

    await user.click(screen.getByLabelText(enPreview.actions.saveImage));
    expect(screen.getByLabelText(enPreview.save.nameLabel)).toHaveValue("My-figure.png");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.saveFileBase64).toHaveBeenCalledWith(PROJECT, "My-figure.png", "aGk="));
    expect(mocks.toast.success).toHaveBeenCalledWith(enPreview.save.imageSaved);
  });

  it("downloads the figure as a PNG where the user picks", async () => {
    await renderPane({ projectKind: "diagram", projectName: "Flow chart" });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: enPreview.actions.downloadImage }));

    await waitFor(() => expect(mocks.writeBytesFile).toHaveBeenCalledWith("/Users/me/Downloads/figure.png", expect.any(String)));
    expect(mocks.pickSavePath).toHaveBeenCalledWith({
      defaultPath: "Flow_chart.png",
      filters: [{ name: enPreview.download.pngFilter, extensions: ["png"] }],
    });
    expect(mocks.toast.successUnique.mock.calls[0][1]).toBe(
      enPreview.download.imageSaved.replace("{{name}}", "figure.png"),
    );
  });

  it("explains a failed figure download with and without detail", async () => {
    await renderPane({ projectKind: "image", projectName: "" });
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: enPreview.actions.downloadImage });

    mocks.writeBytesFile.mockRejectedValueOnce(new Error("disk full"));
    await user.click(button);
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "download preview",
        expect.any(Error),
        enPreview.download.imageFailedDetail.replace("{{detail}}", "disk full"),
      ),
    );

    mocks.writeBytesFile.mockRejectedValueOnce({ code: 5 });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenLastCalledWith("download preview", { code: 5 }, enPreview.download.imageFailed),
    );
  });
});

describe("PreviewPane downloads", () => {
  it("hands the PDF to the browser outside the desktop app", async () => {
    mocks.tauri.enabled = false;
    await renderPane({ projectName: "" });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: enPreview.actions.downloadPdf }));

    await waitFor(() =>
      expect(mocks.downloadBytes).toHaveBeenCalledWith(expect.any(Uint8Array), "application/pdf", "document.pdf"),
    );
    expect(mocks.pickSavePath).not.toHaveBeenCalled();
  });

  it("explains a PDF download that failed with a plain message", async () => {
    mocks.pickSavePath.mockRejectedValueOnce("picker crashed");
    await renderPane();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: enPreview.actions.downloadPdf }));

    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "download preview",
        "picker crashed",
        enPreview.download.pdfFailedDetail.replace("{{detail}}", "picker crashed"),
      ),
    );
  });
});

describe("PreviewPane viewer states", () => {
  it("keeps the last good PDF when a newer one fails to load and offers a recompile", async () => {
    await renderPane();
    const firstIdentity = mocks.viewer?.documentIdentity;

    mocks.firstLoad = "loading";
    act(() => {
      useCompileStore.setState({ pdfBytes: new Uint8Array([4, 5]), lastCompileCheckpoint: checkpoint(2, 2) as never });
    });
    await waitFor(() => expect(mocks.viewer?.documentIdentity).not.toBe(firstIdentity));
    loadState("invalid", { message: "Missing %%EOF" });

    await waitFor(() => expect(mocks.viewer?.documentIdentity).toBe(firstIdentity));
    const badge = screen.getByTestId("preview-stale-badge");
    fireEvent.click(badge);
    expect(useCompileStore.getState().recompile).toHaveBeenCalled();
  });

  it("marks an outdated PDF stale and announces it", async () => {
    mocks.syncTex.available = true;
    await renderPane();

    act(() => activate(3));

    const badge = await screen.findByTestId("preview-stale-badge");
    const announcement = `Stale, non-current PDF. ${enPreview.stale.explanation}`;
    expect(screen.getByText(announcement)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: enPreview.actions.downloadStalePdf })).toBeInTheDocument();

    fireEvent.mouseEnter(badge.parentElement as HTMLElement);
    expect(
      await screen.findByText((text) =>
        text.includes("Showing project revision 2. The active project is revision 3."),
      ),
    ).toBeInTheDocument();

    act(() => useProjectAnalysisStore.getState().setProjectRevision(4));
    expect(
      await screen.findByText((text) =>
        text.includes("Showing project revision 2. The active project is revision 4."),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(announcement)).toBeInTheDocument();
  });

  it("keeps the preview still while edits advance a project whose PDF is already stale", async () => {
    await renderPane();
    act(() => activate(3));
    await screen.findByTestId("preview-stale-badge");
    const renders = mocks.viewerRenders;

    for (let revision = 4; revision < 14; revision++) {
      act(() => {
        useProjectAnalysisStore.getState().setProjectRevision(revision);
      });
    }

    expect(mocks.viewerRenders).toBe(renders);
    expect(screen.getByTestId("preview-stale-badge")).toBeInTheDocument();
  });

  it("clears the stale badge when an edit is reverted to the compiled source", async () => {
    await renderPane({
      activePath: "main.tex",
      loading: false,
      tree: [{ path: "main.tex", is_dir: false }],
      files: { "main.tex": { content: "Compiled.", dirty: false, edits: 0 } },
    });
    act(() =>
      useCompileStore.setState({
        compiledSources: { fsEpoch: projectFilesystemEpoch(), texts: { "main.tex": "Compiled." } },
      } as never),
    );

    act(() => {
      useFilesStore.setState({ files: { "main.tex": { content: "Compiled. Edited.", dirty: true, edits: 1 } } } as never);
      useProjectAnalysisStore.getState().setProjectRevision(3);
    });
    expect(await screen.findByTestId("preview-stale-badge")).toBeInTheDocument();

    act(() => {
      useFilesStore.setState({ files: { "main.tex": { content: "Compiled.", dirty: true, edits: 2 } } } as never);
      useProjectAnalysisStore.getState().setProjectRevision(4);
    });
    await waitFor(() => expect(screen.queryByTestId("preview-stale-badge")).toBeNull());
  });

  it("explains every way a first load can fail and retries", async () => {
    mocks.firstLoad = "loading";
    await renderPane();

    loadState("empty");
    expect(screen.getByText(enPreview.viewer.emptyTitle)).toBeInTheDocument();
    loadState("unavailable");
    expect(screen.getByText(enPreview.viewer.unavailableTitle)).toBeInTheDocument();
    loadState("error");
    expect(screen.getByText(enPreview.viewer.loadFailedTitle)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await waitFor(() => expect(screen.queryByText(enPreview.viewer.loadFailedTitle)).toBeNull());
  });

  it("opens a locked PDF with the typed password", async () => {
    mocks.firstLoad = "password_required";
    await renderPane();

    const field = await screen.findByLabelText(enPreview.password.label);
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    expect(mocks.viewer?.password).toBeUndefined();
    fireEvent.change(field, { target: { value: "hunter2" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);

    await waitFor(() => expect(mocks.viewer?.password).toBe("hunter2"));
  });

  it("jumps from a source click in the PDF when SyncTeX can map it", async () => {
    mocks.syncTex.available = true;
    await renderPane();

    act(() => mocks.viewer?.onInverse?.(2, 10, 20, "theorem"));

    expect(mocks.inverseFromClick).toHaveBeenCalledWith(2, 10, 20, "theorem", expect.objectContaining({ projectId: PROJECT }));
  });

  it("announces the current search result to screen readers", async () => {
    await renderPane();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(enPreview.search.open));
    await user.type(screen.getByLabelText(enPreview.search.input), "lemma");

    act(() =>
      mocks.viewer?.onSearchStateChange?.({ status: "success", query: "lemma", current: 2, total: 5, scannedPages: 3, totalPages: 3 }),
    );

    expect(
      screen.getByText((text) => text.includes(enPreview.a11y.searchResult.replace("{{current}}", "2").replace("{{total}}", "5"))),
    ).toBeInTheDocument();
  });
});

describe("PreviewPane toolbar actions", () => {
  it("jumps to a typed page and ignores an impossible one", async () => {
    await renderPane();
    const field = screen.getByLabelText(enPreview.pages.number);
    mocks.gotoPage.mockClear();

    fireEvent.change(field, { target: { value: "2" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(mocks.gotoPage).toHaveBeenCalledWith(2);

    fireEvent.change(field, { target: { value: "0" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field).toHaveValue("1");
    expect(mocks.gotoPage).toHaveBeenCalledTimes(1);
  });

  it("goes fullscreen, hides and shows its toolbar, and comes back", async () => {
    await renderPane();
    const root = screen.getByTestId("preview-pane");
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
    root.requestFullscreen = vi.fn(async () => {
      fullscreenElement = root;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    document.exitFullscreen = vi.fn(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: enPreview.actions.fullscreen }));
    });
    fireEvent.click(screen.getByRole("button", { name: enPreview.actions.hideToolbar }));
    fireEvent.click(screen.getByRole("button", { name: enPreview.actions.showToolbar }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: enPreview.actions.exitFullscreen }));
    });

    expect(document.exitFullscreen).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: enPreview.actions.fullscreen })).toBeInTheDocument();
  });

  it("opens the PDF settings and starts a presentation from the current page", async () => {
    await renderPane();
    const user = userEvent.setup();
    const openSettingsAt = vi.spyOn(useSettingsStore.getState(), "openSettingsAt");

    await user.click(screen.getByRole("button", { name: enPreview.actions.settings }));
    expect(openSettingsAt).toHaveBeenCalledWith("appearance", "pdf");

    await user.click(screen.getByRole("button", { name: enPreview.presentation.present }));
    await user.click(await screen.findByRole("menuitem", { name: enPreview.presentation.presentFromStart }));
    expect(mocks.present).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJECT, mainDoc: "main.tex", typst: false }));
  });

  it("asks the assistant about compile errors from the log view", async () => {
    await renderPane();
    act(() => {
      useCompileStore.setState({
        status: "error",
        errors: [{ kind: "error", message: "Undefined control sequence", file: "main.tex", line: 1 } as never],
      });
    });

    fireEvent.click(screen.getByRole("button", { name: enPreview.toolbar.showLogs }));
    fireEvent.click(screen.getByRole("button", { name: enPreview.toolbar.askAi }));

    expect(mocks.askAi).toHaveBeenCalledTimes(1);
  });

  it("shows the PDF during the workspace tour and returns to the logs afterwards", async () => {
    await renderPane();
    fireEvent.click(screen.getByRole("button", { name: enPreview.toolbar.showLogs }));
    expect(screen.getByTestId("mock-log-pane")).toBeInTheDocument();

    act(() => useTourStore.setState({ activeTourId: "workspace" }));
    expect(screen.queryByTestId("mock-log-pane")).toBeNull();

    act(() => useTourStore.setState({ activeTourId: null }));
    expect(screen.getByTestId("mock-log-pane")).toBeInTheDocument();
  });
});
