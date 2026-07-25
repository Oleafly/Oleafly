// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let createPdfLinkService: typeof import("./PdfViewer").createPdfLinkService;
let createPdfLinkViewerAdapter: typeof import("./PdfViewer").createPdfLinkViewerAdapter;
let calculatePdfFitScale: typeof import("./PdfViewer").calculatePdfFitScale;
let prioritizePdfPages: typeof import("./PdfViewer").prioritizePdfPages;

beforeAll(async () => {
  // pdf.js creates these browser primitives while its ESM bundle evaluates.
  // The link-service test does not exercise canvas operations, so lightweight
  // constructors are sufficient in jsdom.
  vi.stubGlobal("DOMMatrix", class DOMMatrix {});
  vi.stubGlobal("ImageData", class ImageData {});
  vi.stubGlobal("Path2D", class Path2D {});
  ({
    calculatePdfFitScale,
    createPdfLinkService,
    createPdfLinkViewerAdapter,
    prioritizePdfPages,
  } = await import("./PdfViewer"));
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("PdfViewer link service", () => {
  it("focuses an already-rendered internal destination after scrolling without leaking its listener", async () => {
    let currentPage = 1;
    const order: string[] = [];
    const scrollPageIntoView = vi.fn(() => {
      order.push("scroll");
    });
    const optionalContentConfig = {
      renderingIntent: "display",
      setOCGState: vi.fn(),
    };
    const pdfDocument = {
      pagesMapper: { pagesNumber: 4 },
      getDestination: vi.fn(() =>
        Promise.resolve([1, { name: "XYZ" }, 24, 700, null]),
      ),
      cachedPageNumber: vi.fn(() => null),
      getPageIndex: vi.fn(),
      getAttachmentContent: vi.fn(),
    };
    const destinationTextLayer = document.createElement("div");
    destinationTextLayer.tabIndex = -1;
    document.body.append(destinationTextLayer);
    const focus = vi
      .spyOn(destinationTextLayer, "focus")
      .mockImplementation(() => {
        order.push("focus");
        HTMLElement.prototype.focus.call(destinationTextLayer);
      });
    const service = await createPdfLinkService({
      pdfDocument: pdfDocument as never,
    });
    const removeListener = vi.spyOn(
      Object.getPrototypeOf(service.eventBus) as {
        off: (eventName: string, listener: (...args: unknown[]) => void) => void;
      },
      "off",
    );
    const viewer = createPdfLinkViewerAdapter({
      pagesCount: 4,
      getCurrentPage: () => currentPage,
      setCurrentPage: (pageNumber) => {
        currentPage = pageNumber;
      },
      scrollPageIntoView,
      eventBus: service.eventBus,
      getRenderedTextLayer: (pageNumber) =>
        pageNumber === 2
          ? { div: destinationTextLayer, numTextDivs: 4 }
          : null,
      optionalContentConfigPromise: Promise.resolve(
        optionalContentConfig as never,
      ),
    });
    service.setViewer(viewer);

    await service.goToDestination("methods");
    expect(pdfDocument.getDestination).toHaveBeenCalledWith("methods");
    expect(scrollPageIntoView).toHaveBeenCalledWith({
      pageNumber: 2,
      destArray: [1, { name: "XYZ" }, 24, 700, null],
      ignoreDestinationZoom: true,
    });
    expect(order).toEqual(["scroll", "focus"]);
    expect(document.activeElement).toBe(destinationTextLayer);
    expect(focus).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith(
      "textlayerrendered",
      expect.any(Function),
    );
    focus.mockClear();
    service.eventBus.dispatch("textlayerrendered", {
      pageNumber: 2,
      source: { textLayer: { div: destinationTextLayer } },
    });
    expect(focus).not.toHaveBeenCalled();

    service.executeNamedAction("NextPage");
    expect(currentPage).toBe(2);
    service.executeNamedAction("PrevPage");
    expect(currentPage).toBe(1);
    service.executeNamedAction("LastPage");
    expect(currentPage).toBe(4);
    service.executeNamedAction("FirstPage");
    expect(currentPage).toBe(1);
  });

  it("applies OCG actions and fetches attachment bytes on annotation activation", async () => {
    const attachment = new Uint8Array([0x50, 0x44, 0x46]);
    const optionalContentConfig = {
      renderingIntent: "display",
      setOCGState: vi.fn(),
    };
    const onOptionalContentConfigChange = vi.fn();
    const getAttachmentContent = vi.fn(() => Promise.resolve(attachment));
    const pdfDocument = {
      pagesMapper: { pagesNumber: 1 },
      getAttachmentContent,
    };
    const viewer = createPdfLinkViewerAdapter({
      pagesCount: 1,
      getCurrentPage: () => 1,
      setCurrentPage: vi.fn(),
      scrollPageIntoView: vi.fn(),
      optionalContentConfigPromise: Promise.resolve(
        optionalContentConfig as never,
      ),
      onOptionalContentConfigChange,
    });
    const service = await createPdfLinkService({
      pdfDocument: pdfDocument as never,
      pdfViewer: viewer,
    });
    const action = { state: ["Toggle", "research-layer"] };

    await service.executeSetOCGState(action);
    expect(optionalContentConfig.setOCGState).toHaveBeenCalledWith(action);
    expect(onOptionalContentConfigChange).toHaveBeenCalledOnce();

    // Render and activate pdf.js' real FileAttachmentAnnotationElement. This
    // proves the visible double-click path reaches both catalog lookup and the
    // supplied download manager; it is not a hand-written stand-in listener.
    const { AnnotationLayer, AnnotationType } = await import("pdfjs-dist");
    const layerDiv = document.createElement("div");
    document.body.append(layerDiv);
    const viewport = {
      width: 612,
      height: 792,
      scale: 1,
      rotation: 0,
      userUnit: 1,
      transform: [1, 0, 0, -1, 0, 792],
      rawDims: {
        pageWidth: 612,
        pageHeight: 792,
        pageX: 0,
        pageY: 0,
      },
    };
    const annotationLayer = new AnnotationLayer({
      div: layerDiv,
      accessibilityManager: null,
      annotationCanvasMap: null,
      annotationEditorUIManager: null,
      commentManager: null,
      linkService: service,
      annotationStorage: null,
      page: { view: [0, 0, 612, 792] },
      viewport,
      structTreeLayer: null,
    });
    const downloadManager = { openOrDownloadData: vi.fn() };
    await annotationLayer.render({
      viewport: viewport as never,
      div: layerDiv,
      annotations: [
        {
          id: "attachment-1",
          annotationType: AnnotationType.FILEATTACHMENT,
          rect: [72, 680, 92, 700],
          borderStyle: {
            width: 0,
            style: 1,
            horizontalCornerRadius: 0,
            verticalCornerRadius: 0,
          },
          rotation: 0,
          fileId: "supplement",
          file: { filename: "supplement.txt", content: null },
          name: "Paperclip",
          fillAlpha: 0,
          hasAppearance: false,
          contentsObj: { str: "", dir: "ltr" },
          popupRef: null,
          isEditable: false,
        },
      ],
      page: { view: [0, 0, 612, 792] } as never,
      linkService: service,
      downloadManager: downloadManager as never,
      renderForms: false,
      enableScripting: false,
    });
    const attachmentTrigger = layerDiv.querySelector(
      ".fileAttachmentAnnotation > div",
    );
    expect(attachmentTrigger).not.toBeNull();
    attachmentTrigger?.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );
    await vi.waitFor(() =>
      expect(downloadManager.openOrDownloadData).toHaveBeenCalledWith(
        attachment,
        "supplement.txt",
      ),
    );
    expect(getAttachmentContent).toHaveBeenCalledWith("supplement");
    annotationLayer.destroy();
  });

  it("sets safe external-link attributes through the real service", async () => {
    const service = await createPdfLinkService();
    const link = document.createElement("a");

    expect(() =>
      service.addLinkAttributes(link, "https://example.test/paper", true),
    ).not.toThrow();
    expect(link.href).toBe("https://example.test/paper");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer nofollow");
    expect(service.getDestinationHash("methods")).toBe("#methods");
    expect(service.getAnchorUrl("#results")).toBe("#results");
  });
});

describe("calculatePdfFitScale", () => {
  const pageViewports = new Map([
    [1, { width: 612, height: 792 }],
    [2, { width: 900, height: 630 }],
    [3, { width: 420, height: 600 }],
    [4, { width: 700, height: 1_000 }],
  ]);

  it("fits the exact current page rather than page-one geometry", () => {
    expect(
      calculatePdfFitScale({
        mode: "width",
        layout: "single",
        currentPage: 2,
        pagesCount: 4,
        pageViewports: pageViewports as never,
        viewportWidth: 1_032,
        viewportHeight: 832,
      }),
    ).toBeCloseTo(1_000 / 900);
    expect(
      calculatePdfFitScale({
        mode: "height",
        layout: "single",
        currentPage: 2,
        pagesCount: 4,
        pageViewports: pageViewports as never,
        viewportWidth: 1_032,
        viewportHeight: 832,
      }),
    ).toBeCloseTo(800 / 630);
  });

  it("fits the actual mixed-size two-page spread width and tallest height", () => {
    expect(
      calculatePdfFitScale({
        mode: "width",
        layout: "double",
        currentPage: 2,
        pagesCount: 4,
        pageViewports: pageViewports as never,
        viewportWidth: 1_032,
        viewportHeight: 832,
      }),
    ).toBeCloseTo(1_000 / (612 + 900 + 16));
    expect(
      calculatePdfFitScale({
        mode: "height",
        layout: "double",
        currentPage: 3,
        pagesCount: 4,
        pageViewports: pageViewports as never,
        viewportWidth: 1_032,
        viewportHeight: 832,
      }),
    ).toBeCloseTo(800 / 1_000);
  });

  it("returns null instead of borrowing geometry for an unresolved spread page", () => {
    expect(
      calculatePdfFitScale({
        mode: "width",
        layout: "double",
        currentPage: 3,
        pagesCount: 4,
        pageViewports: new Map([[3, { width: 420, height: 600 }]]) as never,
        viewportWidth: 1_032,
        viewportHeight: 832,
      }),
    ).toBeNull();
  });
});

describe("prioritizePdfPages", () => {
  it("keeps a bounded window nearest the current page when more than 14 are visible", () => {
    const candidates = prioritizePdfPages(
      Array.from({ length: 30 }, (_, index) => index + 1),
      20,
      14,
    );

    expect(candidates).toHaveLength(14);
    expect(candidates[0]).toBe(20);
    expect(candidates).toEqual(expect.arrayContaining([14, 26]));
    expect(candidates).not.toContain(1);
    expect(candidates).not.toContain(30);
  });
});
