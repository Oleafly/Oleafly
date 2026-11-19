// @vitest-environment jsdom
import "@/i18n";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfMark, PdfTextSelectionInfo } from "@oleafly/preview";
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import type { PdfViewerHandle } from "@/components/pdf/PdfViewer";
import type { PdfAnnotation } from "@/lib/tauri";
import { usePdfAnnotationsStore } from "@/store/pdf-annotations";
import { usePdfAnnotations } from "./use-pdf-annotations";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  locateSource: vi.fn(),
  placeAnnotations: vi.fn(),
  handoffToAssistant: vi.fn(),
  ensureAiProviderOrOpenSettings: vi.fn(async () => true),
  gotoRect: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  pdfAnnotationsList: mocks.list,
  pdfAnnotationsAdd: mocks.add,
  pdfAnnotationsUpdate: mocks.update,
  pdfAnnotationsDelete: mocks.remove,
}));
vi.mock("@/features/pdf-annotations/locate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/pdf-annotations/locate")>()),
  locateSource: mocks.locateSource,
}));
vi.mock("@/features/pdf-annotations/place", () => ({ placeAnnotations: mocks.placeAnnotations }));
vi.mock("@/features/synctex", () => ({ sourceText: () => null, typesetLinesOf: async () => null }));
vi.mock("@/features/assistant-handoff", () => ({
  handoffToAssistant: mocks.handoffToAssistant,
  ensureAiProviderOrOpenSettings: mocks.ensureAiProviderOrOpenSettings,
}));
vi.mock("@/components/pdf/pdfController", () => ({ gotoRect: mocks.gotoRect, pdfPageText: async () => null }));

const strings = enPreview.annotations;

const selection: PdfTextSelectionInfo = {
  page: 3,
  rects: [{ page: 3, x: 10, y: 20, width: 100, height: 12 }],
  text: "a claim that needs a citation",
  before: "We make ",
  after: " here.",
  start: { page: 3, x: 11, y: 26 },
  end: { page: 3, x: 109, y: 26 },
  clientRect: { left: 40, top: 60, width: 100, height: 12 },
};

const source = { path: "main.tex", startLine: 4, endLine: 4, excerpt: "We make a claim that needs a citation here." };

function note(patch: Partial<PdfAnnotation> = {}): PdfAnnotation {
  return {
    id: "n1",
    number: 1,
    kind: "comment",
    comment: "Cite it",
    quote: { text: selection.text, before: selection.before, after: selection.after },
    page: 3,
    source,
    boxes: selection.rects,
    build: "build-1",
    origin: "pdf",
    status: "draft",
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

let latest: ReturnType<typeof usePdfAnnotations> | null = null;

function Harness({ build = "build-1", ready = true }: Readonly<{ build?: string; ready?: boolean }>) {
  const annotations = usePdfAnnotations({
    enabled: true,
    projectId: "project",
    build,
    documentReady: ready,
    checkpoint: null,
    syncAvailable: true,
    pdfRef: { current: { gotoPage: vi.fn() } as unknown as PdfViewerHandle },
    containerRef: { current: document.body },
  });
  latest = annotations;
  return <div>{annotations.overlay}</div>;
}

async function mount(items: PdfAnnotation[] = []) {
  mocks.list.mockResolvedValue(items);
  const view = render(<Harness />);
  await waitFor(() => expect(usePdfAnnotationsStore.getState().loaded).toBe(true));
  return view;
}

function select() {
  act(() => latest?.viewerProps.onSelectText?.(selection));
}

beforeEach(() => {
  vi.clearAllMocks();
  latest = null;
  usePdfAnnotationsStore.setState({ projectId: null, items: [], loaded: false, activeId: null, error: null });
  mocks.placeAnnotations.mockResolvedValue([]);
  mocks.locateSource.mockResolvedValue(source);
  mocks.update.mockImplementation(async () => usePdfAnnotationsStore.getState().items);
});

describe("usePdfAnnotations", () => {
  it("saves a comment right away with the quote and its context, then finds the source", async () => {
    await mount();
    select();
    mocks.add.mockResolvedValue(note({ source: null }));
    await userEvent.click(await screen.findByRole("button", { name: strings.composer.action.comment }));
    await userEvent.type(screen.getByRole("textbox"), "Cite it");
    await userEvent.click(screen.getByRole("button", { name: strings.composer.save }));
    expect(mocks.add).toHaveBeenCalledWith("project", {
      kind: "comment",
      comment: "Cite it",
      quote: { text: selection.text, before: selection.before, after: selection.after },
      page: 3,
      source: null,
      boxes: selection.rects,
      build: "build-1",
      origin: "pdf",
    });
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("project", [{ id: "n1", source }]));
  });

  it("adds a delete note straight from the action", async () => {
    await mount();
    select();
    mocks.add.mockResolvedValue(note({ kind: "delete", comment: "" }));
    await userEvent.click(await screen.findByRole("button", { name: strings.composer.action.delete }));
    expect(mocks.add).toHaveBeenCalledWith("project", expect.objectContaining({ kind: "delete", comment: "" }));
  });

  it("draws only notes placed on the PDF on screen", async () => {
    await mount([
      note(),
      note({ id: "n2", number: 2, build: "old" }),
      note({ id: "n3", number: 3, status: "needsPlacing" }),
    ]);
    const marks = latest?.viewerProps.marks as readonly PdfMark[];
    expect(marks.map((mark) => mark.id)).toEqual(["n1"]);
  });

  it("places notes from an earlier PDF again when a new one loads", async () => {
    const view = await mount([note({ build: "old" })]);
    await waitFor(() => expect(mocks.placeAnnotations).toHaveBeenCalled());
    expect(mocks.placeAnnotations.mock.calls[0]?.slice(0, 2)).toEqual([[note({ build: "old" })], "build-1"]);
    mocks.placeAnnotations.mockResolvedValue([{ id: "n1", build: "build-2", boxes: [], status: "needsPlacing" }]);
    view.rerender(<Harness build="build-2" />);
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith("project", [{ id: "n1", build: "build-2", boxes: [], status: "needsPlacing" }]),
    );
  });

  it("waits for the new PDF to load before placing notes again", async () => {
    mocks.list.mockResolvedValue([note({ build: "old" })]);
    const view = render(<Harness ready={false} />);
    await waitFor(() => expect(usePdfAnnotationsStore.getState().loaded).toBe(true));
    expect(mocks.placeAnnotations).not.toHaveBeenCalled();
    view.rerender(<Harness ready />);
    await waitFor(() => expect(mocks.placeAnnotations).toHaveBeenCalledTimes(1));
  });

  it("places a lost note again on a new selection", async () => {
    await mount([note({ status: "needsPlacing", boxes: [], build: "old" })]);
    act(() => latest?.toolbar?.togglePanel());
    await userEvent.click(await screen.findByRole("button", { name: strings.panel.placeAgain }));
    select();
    await userEvent.click(await screen.findByRole("button", { name: strings.composer.placeHere }));
    expect(mocks.update).toHaveBeenCalledWith("project", [
      {
        id: "n1",
        quote: { text: selection.text, before: selection.before, after: selection.after },
        page: 3,
        boxes: selection.rects,
        build: "build-1",
        status: "draft",
      },
    ]);
  });

  it("sends the picked notes to the assistant as context chips", async () => {
    await mount([note(), note({ id: "n2", number: 2, status: "resolved" })]);
    act(() => latest?.toolbar?.togglePanel());
    await userEvent.click(await screen.findByRole("button", { name: strings.panel.send.replace("{{n}}", "1") }));
    expect(mocks.handoffToAssistant).toHaveBeenCalledWith("", {
      autoSend: false,
      context: [{ id: "pdfAnnotation:n1", kind: "pdfAnnotation", refId: "n1", label: "1 · main.tex:4" }],
    });
  });
});
