// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  native: false,
  readCompiledPdf: vi.fn(),
  saveFileBase64: vi.fn(),
  writeBytesFile: vi.fn(),
  pickSavePath: vi.fn(),
  downloadBytes: vi.fn(),
  present: vi.fn(async () => {}),
  closeWindow: vi.fn(async () => {}),
  setTitle: vi.fn(async () => {}),
  toastSuccess: vi.fn(),
  notifyError: vi.fn(),
  listeners: new Map<string, (event: { payload?: unknown }) => void>(),
  gotoPage: vi.fn(),
  getFitScale: vi.fn(() => 1.25),
  viewer: null as null | {
    documentIdentity: string;
    password?: string;
    onLoadStateChange?: (state: Record<string, unknown>) => void;
    onPageChange?: (current: number, total: number) => void;
  },
  pageCount: 3,
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.native }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    title: async () => "Preview: Paper",
    setTitle: mocks.setTitle,
    close: mocks.closeWindow,
  }),
}));
vi.mock("@/lib/preview-geometry", () => ({ usePreviewGeometry: vi.fn(), readPreviewGeometry: () => null }));
vi.mock("@/lib/tauri", () => ({
  readCompiledPdf: mocks.readCompiledPdf,
  saveFileBase64: mocks.saveFileBase64,
  writeBytesFile: mocks.writeBytesFile,
  uint8ToBase64: () => "AQ==",
  appendAppLog: vi.fn(async () => {}),
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: mocks.pickSavePath }));
vi.mock("@/lib/download-blob", () => ({ downloadBytes: mocks.downloadBytes }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/features/presentation/launch", () => ({ present: mocks.present }));
vi.mock("@/lib/toast", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  notifyError: mocks.notifyError,
  toast: { success: mocks.toastSuccess, error: vi.fn(), info: vi.fn() },
}));
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async (name: string, listener: (event: { payload?: unknown }) => void) => {
    mocks.listeners.set(name, listener);
    return () => {
      if (mocks.listeners.get(name) === listener) mocks.listeners.delete(name);
    };
  }),
}));
vi.mock("@/components/ui/toolbar-overflow", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAvailableWidth: () => ({ containerRef: () => {}, availableWidth: Number.POSITIVE_INFINITY }),
}));
vi.mock("@/components/pdf/PdfViewer", async () => {
  const React = await import("react");
  return {
    PdfViewer: React.forwardRef(function MockPdfViewer(
      props: {
        data: Uint8Array;
        documentIdentity: string;
        password?: string;
        onLoadStateChange?: (state: Record<string, unknown>) => void;
        onPageChange?: (current: number, total: number) => void;
      },
      ref: React.ForwardedRef<unknown>,
    ) {
      mocks.viewer = props;
      React.useImperativeHandle(ref, () => ({
        gotoPage: mocks.gotoPage,
        getFitScale: mocks.getFitScale,
      }));
      const latest = React.useRef(props);
      latest.current = props;
      React.useEffect(() => {
        latest.current.onPageChange?.(1, mocks.pageCount);
      }, [props.documentIdentity]);
      return <div data-testid="detached-pdf-bytes">{Array.from(props.data).join(",")}</div>;
    }),
  };
});

import { emitTo } from "@tauri-apps/api/event";
import userEvent from "@testing-library/user-event";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import { COMPILE_CHECKPOINT_VERSION, fingerprintCompileOutput } from "@/lib/compile-checkpoint";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { PreviewWindowState } from "@/lib/preview-window";
import type { PreviewWorkspaceSnapshot } from "@/lib/preview-workspace";
import { PreviewWindow } from "./PreviewWindow";

const win = enPreview.window;

function state(
  projectId: string,
  value: number,
  outputRevision: number,
  overrides: Partial<PreviewWindowState> = {},
): PreviewWindowState {
  const identity = { projectId, mainDocument: "chapters/main.tex", projectRevision: outputRevision, requestGeneration: outputRevision };
  return {
    projectStateRevision: outputRevision,
    identity,
    status: "success",
    checkpoint: {
      ...identity,
      version: COMPILE_CHECKPOINT_VERSION,
      outputKind: "standard",
      producerId: "producer",
      outputRevision,
      outputId: fingerprintCompileOutput(new Uint8Array([value])),
      completedAt: outputRevision,
    },
    ...overrides,
  };
}

function compiling(projectId: string, revision: number, base = 0): PreviewWindowState {
  return {
    projectStateRevision: base,
    identity: { projectId, mainDocument: "chapters/main.tex", projectRevision: revision, requestGeneration: revision },
    status: "compiling",
    checkpoint: null,
  };
}

function refresh(next: unknown) {
  act(() => mocks.listeners.get("preview:refresh")?.({ payload: next }));
}

function loadState(status: string, extra: Record<string, unknown> = {}) {
  act(() =>
    mocks.viewer?.onLoadStateChange?.({ status, documentIdentity: mocks.viewer.documentIdentity, ...extra }),
  );
}

const buffer = (value: number) => new Uint8Array([value]).buffer;

const workspace: PreviewWorkspaceSnapshot = {
  projectId: "alpha", engine: LATEX_ENGINE, engineLoaded: true, mainDoc: "chapters/main.tex",
  status: "error", log: "! Undefined control sequence.", diagnostics: null, compileTimeMs: 300,
  errors: [{ kind: "error", message: "Undefined control sequence", file: "chapters/main.tex", line: 4 } as never],
  compileRevision: 2, autoCompile: false, compileMode: "normal", checkSyntaxBeforeCompile: true, stopOnFirstError: false,
  noMainDocument: false, systemTexLocked: false,
};

beforeEach(() => {
  mocks.native = false;
  window.history.replaceState({}, "", "/?view=preview&project=alpha");
  for (const fn of [
    mocks.readCompiledPdf, mocks.saveFileBase64, mocks.writeBytesFile, mocks.pickSavePath, mocks.downloadBytes,
    mocks.present, mocks.closeWindow, mocks.toastSuccess, mocks.notifyError, mocks.gotoPage,
  ]) fn.mockReset();
  mocks.listeners.clear();
  mocks.viewer = null;
  mocks.pageCount = 3;
  vi.mocked(emitTo).mockClear();
});

describe("detached preview start-up state", () => {
  it("loads the compile that opened the window from its address", async () => {
    mocks.readCompiledPdf.mockResolvedValue(buffer(4));
    const serialized = encodeURIComponent(JSON.stringify(state("alpha", 4, 3)));
    window.history.replaceState({}, "", `/?view=preview&project=alpha&state=${serialized}`);

    render(<PreviewWindow />);

    expect(await screen.findByTestId("detached-pdf-bytes")).toHaveTextContent("4");
    expect(mocks.readCompiledPdf).toHaveBeenCalledWith("alpha");
  });

  it.each([
    ["malformed", "{not json"],
    ["for another project", JSON.stringify(state("beta", 1, 1))],
    ["oversized", "x".repeat(40_000)],
  ])("ignores a %s address state", async (_label, raw) => {
    window.history.replaceState({}, "", `/?view=preview&project=alpha&state=${encodeURIComponent(raw)}`);

    render(<PreviewWindow />);

    expect(screen.getByText(win.noVerifiedTitle)).toBeInTheDocument();
    expect(mocks.readCompiledPdf).not.toHaveBeenCalled();
  });
});

describe("detached preview compile states", () => {
  it("names the compile state while no verified PDF is shown", async () => {
    render(<PreviewWindow />);
    await waitFor(() => expect(mocks.listeners.has("preview:refresh")).toBe(true));

    refresh(compiling("alpha", 1));
    expect(screen.getByText(win.compilingTitle)).toBeInTheDocument();
    expect(screen.getByText(win.compilingDetail)).toBeInTheDocument();

    refresh({ ...compiling("alpha", 2), status: "error", message: "Undefined control sequence" });
    expect(screen.getByText(win.compileFailedTitle)).toBeInTheDocument();
    expect(screen.getByText("Undefined control sequence")).toBeInTheDocument();

    refresh({ ...compiling("alpha", 3), status: "unavailable" });
    expect(screen.getByText(win.compileUnavailableTitle)).toBeInTheDocument();
  });

  it("keeps a success when an older compile of the same request reports in late", async () => {
    mocks.readCompiledPdf.mockResolvedValue(buffer(5));
    render(<PreviewWindow />);
    await waitFor(() => expect(mocks.listeners.has("preview:refresh")).toBe(true));
    refresh(state("alpha", 5, 5));
    await screen.findByText("5");

    refresh({ ...compiling("alpha", 5, 5), status: "error" });
    refresh({ ...compiling("alpha", 4, 5) });

    expect(screen.queryByText(win.staleHeading)).not.toBeInTheDocument();
  });

  it("marks the shown PDF stale while a newer revision compiles or fails", async () => {
    mocks.readCompiledPdf.mockResolvedValue(buffer(5));
    render(<PreviewWindow />);
    await waitFor(() => expect(mocks.listeners.has("preview:refresh")).toBe(true));
    refresh(state("alpha", 5, 5));
    await screen.findByText("5");

    refresh(compiling("alpha", 6, 5));
    expect(screen.getByText(win.staleHeading)).toBeInTheDocument();
    expect(screen.getByText(win.staleCompiling.replace("{{revision}}", "5"))).toBeInTheDocument();

    refresh({ ...compiling("alpha", 6, 5), status: "error" });
    expect(
      screen.getByText(win.staleCompileFailed.replace("{{detail}}", win.staleCompileFailedDetail)),
    ).toBeInTheDocument();
  });

  it("follows a compile from another project", async () => {
    mocks.readCompiledPdf.mockResolvedValue(buffer(2));
    render(<PreviewWindow />);
    await waitFor(() => expect(mocks.listeners.has("preview:refresh")).toBe(true));

    refresh(state("beta", 2, 2));

    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(mocks.readCompiledPdf).toHaveBeenCalledWith("beta");
  });

  it("refuses a PDF whose bytes do not match the compile and retries on request", async () => {
    mocks.readCompiledPdf.mockResolvedValueOnce(buffer(9)).mockResolvedValueOnce(buffer(1));
    render(<PreviewWindow />);
    await waitFor(() => expect(mocks.listeners.has("preview:refresh")).toBe(true));

    refresh(state("alpha", 1, 1));

    expect(await screen.findByText(win.artifactUnavailableTitle)).toBeInTheDocument();
    expect(screen.getByText(win.artifactFailure)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByTestId("detached-pdf-bytes")).toHaveTextContent("1");
  });
});

describe("detached preview viewer recovery", () => {
  async function showDocument(value: number, revision: number) {
    mocks.readCompiledPdf.mockResolvedValueOnce(buffer(value));
    refresh(state("alpha", value, revision));
    await screen.findByText(String(value));
  }

  it("falls back to the last good PDF when a newer one cannot be loaded", async () => {
    render(<PreviewWindow />);
    await waitFor(() => expect(mocks.listeners.has("preview:refresh")).toBe(true));
    await showDocument(1, 1);
    loadState("ready");

    await showDocument(2, 2);
    loadState("invalid", { message: "Missing %%EOF" });

    expect(await screen.findByText("1")).toBeInTheDocument();
    expect(
      screen.getByText(enPreview.viewer.retainedFailure.replace("{{detail}}", "Missing %%EOF")),
    ).toBeInTheDocument();
  });

  it("explains a failed load and retries the viewer", async () => {
    render(<PreviewWindow />);
    await waitFor(() => expect(mocks.listeners.has("preview:refresh")).toBe(true));
    await showDocument(1, 1);

    loadState("empty");
    expect(screen.getByText(enPreview.viewer.emptyTitle)).toBeInTheDocument();
    loadState("unavailable");
    expect(screen.getByText(enPreview.viewer.unavailableTitle)).toBeInTheDocument();
    loadState("error");
    expect(screen.getByText(enPreview.viewer.loadFailedTitle)).toBeInTheDocument();
    expect(screen.getByText(enPreview.viewer.loadFailedDetail)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(screen.getByText(win.retryingLoad)).toBeInTheDocument();

    loadState("loading", { progress: 0.42 });
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("unlocks a password-protected PDF with the typed password", async () => {
    render(<PreviewWindow />);
    await waitFor(() => expect(mocks.listeners.has("preview:refresh")).toBe(true));
    await showDocument(1, 1);

    loadState("password_required");
    const field = await screen.findByLabelText(enPreview.password.label);
    fireEvent.change(field, { target: { value: "s3cret" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);

    await waitFor(() => expect(mocks.viewer?.password).toBe("s3cret"));
  });
});

describe("detached preview actions", () => {
  async function showDocument() {
    mocks.readCompiledPdf.mockResolvedValue(buffer(1));
    render(<PreviewWindow />);
    await waitFor(() => expect(mocks.listeners.has("preview:refresh")).toBe(true));
    refresh(state("alpha", 1, 1));
    await screen.findByText("1");
    loadState("ready");
  }

  it("starts a browser download outside the desktop app", async () => {
    await showDocument();

    fireEvent.click(screen.getByRole("button", { name: enPreview.actions.downloadPdf }));

    await waitFor(() =>
      expect(mocks.downloadBytes).toHaveBeenCalledWith(expect.any(Uint8Array), "application/pdf", "chapters_main.pdf"),
    );
    expect(await screen.findByText(win.downloadStarted)).toBeInTheDocument();
  });

  it("saves the download where the user picks and does nothing when cancelled", async () => {
    mocks.native = true;
    await showDocument();
    mocks.pickSavePath.mockResolvedValueOnce(null).mockResolvedValueOnce("/tmp/main.pdf");

    fireEvent.click(screen.getByRole("button", { name: enPreview.actions.downloadPdf }));
    await waitFor(() => expect(mocks.pickSavePath).toHaveBeenCalledTimes(1));
    expect(mocks.writeBytesFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: enPreview.actions.downloadPdf }));
    expect(await screen.findByText(win.downloadSaved)).toBeInTheDocument();
    expect(mocks.writeBytesFile).toHaveBeenCalledWith("/tmp/main.pdf", "AQ==");
  });

  it("saves the PDF into the project and asks the main window to refresh its files", async () => {
    await showDocument();
    mocks.saveFileBase64.mockResolvedValue(undefined);

    fireEvent.click(screen.getByRole("button", { name: enPreview.actions.savePdf }));
    const name = screen.getByLabelText(enPreview.save.nameLabel);
    expect(name).toHaveValue("chapters/main.pdf");
    fireEvent.change(name, { target: { value: "  " } });
    fireEvent.keyDown(name, { key: "Enter" });

    await waitFor(() => expect(mocks.saveFileBase64).toHaveBeenCalledWith("alpha", "document.pdf", "AQ=="));
    expect(emitTo).toHaveBeenCalledWith("main", "preview:command", { projectId: "alpha", action: "refresh-files" });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(enPreview.save.pdfSaved);
  });

  it("jumps to a typed page and restores the field for an impossible one", async () => {
    await showDocument();
    const field = screen.getByLabelText(enPreview.pages.number);
    mocks.gotoPage.mockClear();

    fireEvent.change(field, { target: { value: "3" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(mocks.gotoPage).toHaveBeenCalledWith(3);

    fireEvent.change(field, { target: { value: "9" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field).toHaveValue("1");
    expect(mocks.gotoPage).toHaveBeenCalledTimes(1);
  });

  it("enters fullscreen, hides and restores the toolbar, and leaves fullscreen", async () => {
    await showDocument();
    const root = screen.getByTestId("detached-preview-window");
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
    expect(screen.queryByRole("button", { name: enPreview.actions.showToolbar })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: enPreview.actions.exitFullscreen }));
    });
    expect(document.exitFullscreen).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: enPreview.actions.fullscreen })).toBeInTheDocument();
  });

  it("sends the window back to the main window and opens the PDF settings there", async () => {
    mocks.native = true;
    await showDocument();
    await waitFor(() => expect(mocks.listeners.has("preview:workspace")).toBe(true));

    fireEvent.click(screen.getByTestId("preview-reattach"));
    expect(mocks.closeWindow).toHaveBeenCalledTimes(1);
    const dockButtons = screen.getAllByRole("button", { name: enAi.shell.dockBack });
    fireEvent.click(dockButtons.at(-1) as HTMLElement);
    expect(mocks.closeWindow).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: enPreview.actions.settings }));
    expect(emitTo).toHaveBeenCalledWith("main", "preview:command", { projectId: "alpha", action: "pdf-settings" });
  });

  it("shows the compile log and asks the assistant about its errors", async () => {
    mocks.native = true;
    await showDocument();
    await waitFor(() => expect(mocks.listeners.has("preview:workspace")).toBe(true));
    act(() => mocks.listeners.get("preview:workspace")?.({ payload: workspace }));

    fireEvent.click(screen.getByRole("button", { name: enPreview.toolbar.showLogs }));
    expect(screen.getByTestId("detached-compile-log")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enPreview.toolbar.askAi }));

    expect(emitTo).toHaveBeenCalledWith("main", "preview:command", { projectId: "alpha", action: "ask-ai" });
  });

  it("asks the main window to compile", async () => {
    mocks.native = true;
    await showDocument();
    await waitFor(() => expect(mocks.listeners.has("preview:workspace")).toBe(true));
    act(() => mocks.listeners.get("preview:workspace")?.({ payload: { ...workspace, status: "success", errors: [] } }));

    fireEvent.click(screen.getByTestId("compile-button"));

    expect(emitTo).toHaveBeenCalledWith("main", "preview:command", expect.objectContaining({ projectId: "alpha", action: "compile" }));
  });

  it("keeps the window title on the project name", async () => {
    mocks.native = true;
    const { applyLocale } = await import("@/i18n");
    await showDocument();

    await act(async () => {
      await applyLocale("en");
    });

    await waitFor(() => expect(mocks.setTitle).toHaveBeenCalledWith(expect.stringContaining("Paper")));
  });
});

describe("detached preview zoom and settings", () => {
  async function showDocument() {
    mocks.native = true;
    mocks.readCompiledPdf.mockResolvedValue(buffer(1));
    render(<PreviewWindow />);
    await waitFor(() => expect(mocks.listeners.has("preview:refresh")).toBe(true));
    refresh(state("alpha", 1, 1));
    await screen.findByText("1");
    loadState("ready");
  }

  const zoomLabel = (percent: number) => enPreview.zoom.percentLabel.replace("{{percent}}", String(percent));

  it("fits the page from the zoom menu and refits when the window resizes", async () => {
    const observers: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      await showDocument();
      const user = userEvent.setup();
      mocks.getFitScale.mockReturnValue(2);

      await user.click(screen.getByLabelText(/^Zoom \d+ percent$/));
      await user.click(await screen.findByRole("menuitem", { name: enPreview.zoom.fitToWidth }));
      expect(mocks.getFitScale).toHaveBeenLastCalledWith("width");
      expect(screen.getByLabelText(zoomLabel(200))).toBeInTheDocument();

      mocks.getFitScale.mockReturnValue(0.5);
      await act(async () => {
        for (const callback of observers) callback([], {} as ResizeObserver);
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      });
      expect(screen.getByLabelText(zoomLabel(50))).toBeInTheDocument();

      await user.click(screen.getByLabelText(zoomLabel(50)));
      await user.click(await screen.findByRole("menuitem", { name: enPreview.zoom.fitToHeight }));
      expect(mocks.getFitScale).toHaveBeenLastCalledWith("height");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("zooms with a pinch on the trackpad", async () => {
    await showDocument();
    const before = screen.getByLabelText(/^Zoom \d+ percent$/).getAttribute("aria-label");
    const event = new Event("wheel", { cancelable: true, bubbles: true });
    Object.defineProperties(event, { ctrlKey: { value: true }, deltaY: { value: -50 } });

    act(() => {
      screen.getByTestId("detached-preview-scroll").dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByLabelText(/^Zoom \d+ percent$/).getAttribute("aria-label")).not.toBe(before);
  });

  it("forwards compile option changes to the main window", async () => {
    await showDocument();
    await waitFor(() => expect(mocks.listeners.has("preview:workspace")).toBe(true));
    act(() => mocks.listeners.get("preview:workspace")?.({ payload: { ...workspace, status: "success", errors: [] } }));
    const user = userEvent.setup();
    const choose = async (name: string | RegExp) => {
      await user.click(screen.getByLabelText(enShell.compile.options));
      await user.click(await screen.findByRole("menuitemradio", { name }));
    };

    await choose(enShell.compile.autoCompile.on);
    expect(emitTo).toHaveBeenCalledWith("main", "preview:command", { projectId: "alpha", action: "auto-compile", value: true });
    await choose(/^Fast/);
    expect(emitTo).toHaveBeenCalledWith("main", "preview:command", { projectId: "alpha", action: "compile-mode", value: "fast" });
    await choose(enShell.compile.syntax.skip);
    expect(emitTo).toHaveBeenCalledWith("main", "preview:command", { projectId: "alpha", action: "syntax-check", value: false });
    await user.click(screen.getByLabelText(enShell.compile.options));
    await user.click(await screen.findByTestId("compiler-pdflatex"));
    expect(emitTo).toHaveBeenCalledWith("main", "preview:command", {
      projectId: "alpha",
      action: "engine",
      engine: "latexmk",
      flavor: "pdflatex",
    });
  });

  it("presents from the detached window", async () => {
    await showDocument();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: enPreview.presentation.present }));
    await user.click(await screen.findByRole("menuitem", { name: enPreview.presentation.presentFromStart }));

    expect(mocks.present).toHaveBeenCalledWith(expect.objectContaining({ projectId: "alpha", mainDoc: "chapters/main.tex" }));
  });

  it("offers to retry when a newer PDF could not be read while an older one stays up", async () => {
    await showDocument();
    mocks.readCompiledPdf.mockReset().mockRejectedValueOnce(new Error("locked")).mockResolvedValueOnce(buffer(2));

    refresh(state("alpha", 2, 2));
    expect(await screen.findByText(win.artifactFailure)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.retry }));

    expect(await screen.findByText("2")).toBeInTheDocument();
  });

  it("closes the save dialog without saving", async () => {
    await showDocument();

    fireEvent.click(screen.getByRole("button", { name: enPreview.actions.savePdf }));
    fireEvent.click(screen.getAllByRole("button", { name: enPreview.save.close }).at(-1) as HTMLElement);

    expect(screen.queryByLabelText(enPreview.save.nameLabel)).toBeNull();
    expect(mocks.saveFileBase64).not.toHaveBeenCalled();
  });
});
