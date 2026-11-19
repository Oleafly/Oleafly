// @vitest-environment jsdom

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";

interface FakeViewerProps {
  documentIdentity: string;
  rotation: number;
  password?: string;
  searchQuery: string;
  onLoadStateChange: (state: { status: string; documentIdentity: string; message?: string }) => void;
  onPageChange: (page: number, total: number) => void;
}

const viewer = vi.hoisted(() => ({
  gotoPage: vi.fn(),
  status: "ready",
  message: undefined as string | undefined,
  props: null as FakeViewerProps | null,
}));
const tauri = vi.hoisted(() => ({ readFileBase64: vi.fn() }));
const events = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload?: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/event", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/event")>()),
  listen: vi.fn(async (name: string, listener: (event: { payload?: unknown }) => void) => {
    events.listeners.set(name, listener);
    return () => events.listeners.delete(name);
  }),
}));
vi.mock("@/components/ui/toolbar-overflow", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAvailableWidth: () => ({ containerRef: () => {}, availableWidth: Number.POSITIVE_INFINITY }),
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readFileBase64: tauri.readFileBase64,
}));
vi.mock("@/components/pdf/PdfViewer", () => ({
  PdfViewer: forwardRef(function FakePdfViewer(props: FakeViewerProps, ref) {
    useImperativeHandle(ref, () => ({
      gotoPage: viewer.gotoPage,
      getFitScale: () => 1.5,
      findNext: vi.fn(),
      findPrevious: vi.fn(),
      activateOutlineItem: vi.fn(),
    }));
    const latest = useRef(props);
    latest.current = props;
    viewer.props = props;
    const { documentIdentity } = props;
    useEffect(() => {
      latest.current.onLoadStateChange({ status: viewer.status, documentIdentity, message: viewer.message });
      latest.current.onPageChange(1, 3);
    }, [documentIdentity]);
    return (
      <div
        data-testid="pdf-viewer"
        data-rotation={props.rotation}
        data-identity={documentIdentity}
        data-password={props.password ?? ""}
        data-search={props.searchQuery}
      />
    );
  }),
}));

import { PdfFileView } from "./PdfFileView";

const actions = enPreview.actions;
const PDF = "JVBERi0xLjQK";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function identity(): string {
  return screen.getByTestId("pdf-viewer").getAttribute("data-identity") ?? "";
}

function scrollArea(): HTMLElement {
  return screen.getByRole("region", { name: enPreview.viewer.scrollArea });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  viewer.status = "ready";
  viewer.message = undefined;
  viewer.props = null;
  events.listeners.clear();
  Reflect.deleteProperty(globalThis, "isTauri");
  Reflect.deleteProperty(document, "fullscreenElement");
  useSettingsStore.getState().setPdfDarkMode(false);
  localStorage.clear();
});

describe("PdfFileView", () => {
  it("gives a project PDF the preview toolbar, without the compiled output's save and window actions", async () => {
    tauri.readFileBase64.mockResolvedValue(PDF);
    render(<PdfFileView projectId="p1" path="figures/attention.pdf" />);
    expect(screen.getByText(enCommon.state.loading)).toBeInTheDocument();
    expect(await screen.findByTestId("pdf-viewer")).toBeInTheDocument();
    expect(tauri.readFileBase64).toHaveBeenCalledWith("p1", "figures/attention.pdf");

    expect(screen.getByRole("button", { name: actions.rotate })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: actions.settings })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: enPreview.pages.number })).toHaveValue("1");
    expect(screen.queryByRole("button", { name: actions.openWindow })).toBeNull();
    expect(screen.queryByRole("button", { name: actions.savePdf })).toBeNull();
    expect(screen.queryByRole("button", { name: actions.downloadDisplayedPdf })).toBeNull();
  });

  it("rotates the page and jumps to a typed page", async () => {
    tauri.readFileBase64.mockResolvedValue(PDF);
    render(<PdfFileView projectId="p1" path="paper.pdf" />);
    await screen.findByTestId("pdf-viewer");

    fireEvent.click(screen.getByRole("button", { name: actions.rotate }));
    expect(screen.getByTestId("pdf-viewer")).toHaveAttribute("data-rotation", "90");

    const pageBox = screen.getByRole("textbox", { name: enPreview.pages.number });
    fireEvent.change(pageBox, { target: { value: "3" } });
    fireEvent.keyDown(pageBox, { key: "Enter" });
    await waitFor(() => expect(viewer.gotoPage).toHaveBeenCalledWith(3));
  });

  it("opens the PDF settings from its toolbar", async () => {
    tauri.readFileBase64.mockResolvedValue(PDF);
    const openSettingsAt = vi.spyOn(useSettingsStore.getState(), "openSettingsAt");
    render(<PdfFileView projectId="p1" path="paper.pdf" />);
    await screen.findByTestId("pdf-viewer");
    act(() => screen.getByRole("button", { name: actions.settings }).click());
    expect(openSettingsAt).toHaveBeenCalledWith("appearance", "pdf");
    openSettingsAt.mockRestore();
  });

  it("says why a PDF cannot be read and reads it again on retry", async () => {
    tauri.readFileBase64.mockRejectedValueOnce("denied").mockResolvedValueOnce(PDF);
    render(<PdfFileView projectId="p1" path="locked.pdf" />);
    expect(await screen.findByText(enEditor.shell.pdfLoadFailed.replace("{{detail}}", "denied"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enPreview.viewer.retry }));
    expect(await screen.findByTestId("pdf-viewer")).toBeInTheDocument();
  });

  it("fits a newly opened PDF to the width", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    tauri.readFileBase64.mockResolvedValue(PDF);
    render(<PdfFileView projectId="p1" path="paper.pdf" />);
    await screen.findByTestId("pdf-viewer");
    expect(screen.getByRole("button", { name: enPreview.zoom.percentLabel.replace("{{percent}}", "100") })).toBeInTheDocument();

    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
    expect(screen.getByRole("button", { name: enPreview.zoom.percentLabel.replace("{{percent}}", "150") })).toBeInTheDocument();
  });

  it("keeps the reader's own zoom when it changes before the fit lands", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    tauri.readFileBase64.mockResolvedValue(PDF);
    render(<PdfFileView projectId="p1" path="paper.pdf" />);
    await screen.findByTestId("pdf-viewer");

    fireEvent.click(screen.getByRole("button", { name: enPreview.zoom.in }));
    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
    expect(screen.getByRole("button", { name: enPreview.zoom.percentLabel.replace("{{percent}}", "120") })).toBeInTheDocument();
  });

  it("reads the PDF again when a sync rewrites this file, and only this file", async () => {
    Object.assign(globalThis, { isTauri: true });
    tauri.readFileBase64.mockResolvedValue(PDF);
    render(<PdfFileView projectId="p1" path="paper.pdf" />);
    await screen.findByTestId("pdf-viewer");
    await waitFor(() => expect(events.listeners.has("pdf-sync:written")).toBe(true));
    const first = identity();

    const written = events.listeners.get("pdf-sync:written");
    act(() => written?.({ payload: { projectId: "p1", path: "other.pdf" } }));
    act(() => written?.({ payload: { projectId: "p2", path: "paper.pdf" } }));
    act(() => written?.({}));
    expect(tauri.readFileBase64).toHaveBeenCalledOnce();

    act(() => written?.({ payload: { projectId: "p1", path: "paper.pdf" } }));
    await waitFor(() => expect(identity()).not.toBe(first));
    expect(tauri.readFileBase64).toHaveBeenCalledTimes(2);
  });

  it("keeps only the newest read when the file changes before an older read returns", async () => {
    const stale = deferred<string>();
    const staleFailure = deferred<string>();
    tauri.readFileBase64
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(staleFailure.promise)
      .mockResolvedValueOnce(PDF);
    const { rerender } = render(<PdfFileView projectId="p1" path="a.pdf" />);
    rerender(<PdfFileView projectId="p1" path="b.pdf" />);
    rerender(<PdfFileView projectId="p1" path="c.pdf" />);
    await screen.findByTestId("pdf-viewer");
    expect(identity()).toContain("c.pdf");

    await act(async () => {
      stale.resolve(PDF);
      staleFailure.reject("gone");
      await Promise.resolve();
    });
    expect(identity()).toContain("c.pdf");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens the outline and search panels from the toolbar and closes them again", async () => {
    tauri.readFileBase64.mockResolvedValue(PDF);
    render(<PdfFileView projectId="p1" path="paper.pdf" />);
    await screen.findByTestId("pdf-viewer");
    const outline = document.getElementById("file-pdf-outline");
    expect(outline).toHaveAttribute("inert");

    fireEvent.click(screen.getByRole("button", { name: enPreview.outline.open }));
    expect(outline).not.toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: enPreview.outline.close }));
    expect(outline).toHaveAttribute("inert");

    expect(screen.queryByRole("textbox", { name: enPreview.search.input })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: enPreview.search.open }));
    fireEvent.change(screen.getByRole("textbox", { name: enPreview.search.input }), { target: { value: "attention" } });
    await waitFor(() => expect(screen.getByTestId("pdf-viewer")).toHaveAttribute("data-search", "attention"));

    fireEvent.click(screen.getByRole("button", { name: enPreview.search.close }));
    expect(screen.queryByRole("textbox", { name: enPreview.search.input })).toBeNull();
    await waitFor(() => expect(screen.getByTestId("pdf-viewer")).toHaveAttribute("data-search", ""));
  });

  it("inverts the page colours, except in reader view", async () => {
    tauri.readFileBase64.mockResolvedValue(PDF);
    render(<PdfFileView projectId="p1" path="paper.pdf" />);
    await screen.findByTestId("pdf-viewer");
    expect(scrollArea().style.filter).toBe("");

    fireEvent.click(screen.getByRole("button", { name: actions.invert }));
    expect(scrollArea().style.filter).toBe("var(--oleafly-pdf-dark-filter)");

    fireEvent.click(screen.getByRole("button", { name: actions.readerView }));
    expect(scrollArea().style.filter).toBe("");
  });

  it("hides the toolbar in fullscreen until the reader asks for it back", async () => {
    tauri.readFileBase64.mockResolvedValue(PDF);
    render(<PdfFileView projectId="p1" path="paper.pdf" />);
    await screen.findByTestId("pdf-viewer");
    const root = screen.getByTestId("pdf-file-view");
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => root });
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    const rotate = screen.getByRole("button", { name: actions.rotate });
    expect(rotate.closest(".hidden")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: actions.hideToolbar }));
    expect(rotate.closest(".hidden")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: actions.showToolbar }));
    expect(screen.queryByRole("button", { name: actions.showToolbar })).toBeNull();
    expect(rotate.closest(".hidden")).toBeNull();
  });

  it("covers the page while the PDF opens", async () => {
    viewer.status = "loading";
    viewer.message = "Opening the PDF";
    tauri.readFileBase64.mockResolvedValue(PDF);
    render(<PdfFileView projectId="p1" path="paper.pdf" />);
    await screen.findByTestId("pdf-viewer");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(enPreview.window.loadingTitle);
    expect(status).toHaveTextContent("Opening the PDF");
    expect(screen.queryByRole("button", { name: enPreview.viewer.retry })).toBeNull();
  });

  it("says why the viewer could not open the PDF and reads it again on retry", async () => {
    viewer.status = "error";
    tauri.readFileBase64.mockResolvedValue(PDF);
    render(<PdfFileView projectId="p1" path="paper.pdf" />);
    await screen.findByTestId("pdf-viewer");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(enPreview.viewer.loadFailedTitle);
    expect(alert).toHaveTextContent(enPreview.viewer.loadFailedDetail);
    const first = identity();

    viewer.status = "ready";
    fireEvent.click(screen.getByRole("button", { name: enPreview.viewer.retry }));
    await waitFor(() => expect(identity()).not.toBe(first));
    expect(tauri.readFileBase64).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks for the password of a locked PDF and opens it with that password", async () => {
    viewer.status = "password_required";
    viewer.message = "This PDF is password protected.";
    tauri.readFileBase64.mockResolvedValue(PDF);
    render(<PdfFileView projectId="p1" path="secret.pdf" />);
    await screen.findByTestId("pdf-viewer");
    expect(screen.getByText("This PDF is password protected.")).toBeInTheDocument();
    const unlock = screen.getByRole("button", { name: enPreview.password.submit });
    expect(unlock).toBeDisabled();

    fireEvent.change(screen.getByLabelText(enPreview.password.label), { target: { value: "hunter2" } });
    fireEvent.click(unlock);
    expect(screen.getByTestId("pdf-viewer")).toHaveAttribute("data-password", "hunter2");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(enPreview.window.loadingTitle);
    expect(status).toHaveTextContent(enPreview.window.unlocking);
  });

  it("ignores load reports for a document it no longer shows, and an idle viewer", async () => {
    tauri.readFileBase64.mockResolvedValue(PDF);
    render(<PdfFileView projectId="p1" path="paper.pdf" />);
    await screen.findByTestId("pdf-viewer");

    act(() => viewer.props?.onLoadStateChange({ status: "error", documentIdentity: "p1\nold.pdf\n0", message: "Old failure" }));
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => viewer.props?.onLoadStateChange({ status: "idle", documentIdentity: identity() }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
