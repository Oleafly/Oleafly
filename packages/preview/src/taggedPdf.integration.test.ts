// @vitest-environment jsdom

import {
  endMarkedContent,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  StandardFonts,
} from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type ViewerRuntime = typeof import("pdfjs-dist/web/pdf_viewer.mjs");

let pdfjs: PdfJs;
let viewerRuntime: ViewerRuntime;
const setupOrder: string[] = [];
let previousPdfjsLibDescriptor: PropertyDescriptor | undefined;

function restorePdfjsLib(): void {
  if (previousPdfjsLibDescriptor) {
    Object.defineProperty(
      globalThis,
      "pdfjsLib",
      previousPdfjsLibDescriptor,
    );
  } else {
    Reflect.deleteProperty(globalThis, "pdfjsLib");
  }
}

beforeAll(async () => {
  // The production viewer bundle probes these browser primitives at import
  // time. Structure-tree rendering itself does not need real canvas methods.
  vi.stubGlobal("DOMMatrix", class DOMMatrix {});
  vi.stubGlobal("ImageData", class ImageData {});
  vi.stubGlobal("Path2D", class Path2D {});
  previousPdfjsLibDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "pdfjsLib",
  );
  vi.resetModules();

  pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  setupOrder.push("core");
  Object.defineProperty(globalThis, "pdfjsLib", {
    configurable: true,
    enumerable: true,
    value: pdfjs,
    writable: true,
  });
  setupOrder.push("global");
  try {
    viewerRuntime = await import("pdfjs-dist/web/pdf_viewer.mjs");
    setupOrder.push("viewer");
  } finally {
    restorePdfjsLib();
  }
});

afterAll(() => {
  restorePdfjsLib();
  vi.resetModules();
  vi.unstubAllGlobals();
});

async function makeDeterministicTaggedPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);

  const beginStructureContent = (tag: "H1" | "P", mcid: number) =>
    PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
      PDFName.of(tag),
      // pdf-lib's public operator type omits inline dictionaries even though
      // PDF BDC explicitly accepts one. The registered object serializes as
      // `/Tag << /MCID n >> BDC`, which pdf.js then resolves into content IDs.
      document.context.obj({ MCID: mcid }) as never,
    ]);

  page.pushOperators(beginStructureContent("H1", 0));
  page.drawText("Tagged research heading", {
    x: 72,
    y: 720,
    size: 20,
    font,
  });
  page.pushOperators(endMarkedContent());

  page.pushOperators(beginStructureContent("P", 1));
  page.drawText("First tagged paragraph in reading order.", {
    x: 72,
    y: 680,
    size: 12,
    font,
  });
  page.pushOperators(endMarkedContent());

  page.pushOperators(beginStructureContent("P", 2));
  page.drawText("Second tagged paragraph follows.", {
    x: 72,
    y: 650,
    size: 12,
    font,
  });
  page.pushOperators(endMarkedContent());
  page.node.set(PDFName.of("StructParents"), PDFNumber.of(0));

  const structureRoot = document.context.obj({ Type: "StructTreeRoot" });
  const structureRootRef = document.context.register(structureRoot);
  const structureElement = (
    role: "H1" | "P",
    mcid: number,
    title: string,
  ) =>
    document.context.register(
      document.context.obj({
        Type: "StructElem",
        S: role,
        P: structureRootRef,
        Pg: page.ref,
        K: mcid,
        T: title,
      }),
    );
  const heading = structureElement("H1", 0, "Research heading");
  const firstParagraph = structureElement("P", 1, "First paragraph");
  const secondParagraph = structureElement("P", 2, "Second paragraph");
  const parentTree = document.context.register(
    document.context.obj({
      Nums: [0, [heading, firstParagraph, secondParagraph]],
    }),
  );

  structureRoot.set(
    PDFName.of("K"),
    document.context.obj([heading, firstParagraph, secondParagraph]),
  );
  structureRoot.set(PDFName.of("ParentTree"), parentTree);
  structureRoot.set(PDFName.of("ParentTreeNextKey"), PDFNumber.of(1));
  document.catalog.set(PDFName.of("StructTreeRoot"), structureRootRef);
  document.catalog.set(
    PDFName.of("MarkInfo"),
    document.context.obj({ Marked: true }),
  );

  return document.save({ useObjectStreams: false });
}

describe("real tagged PDF structure", () => {
  it("loads core, installs its global, then evaluates the viewer runtime", () => {
    expect(setupOrder).toEqual(["core", "global", "viewer"]);
    expect(viewerRuntime.StructTreeLayerBuilder).toBeTypeOf("function");
    expect(Object.getOwnPropertyDescriptor(globalThis, "pdfjsLib")).toEqual(
      previousPdfjsLibDescriptor,
    );
  });

  it("preserves heading and paragraph reading order through pdf.js", async () => {
    const bytes = await makeDeterministicTaggedPdf();
    const loadingTask = pdfjs.getDocument({
      data: bytes.slice(),
      standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`,
    });

    try {
      const document = await loadingTask.promise;
      const page = await document.getPage(1);
      try {
        const structure = await page.getStructTree();
        expect(structure).toMatchObject({
          role: "Root",
          children: [
            {
              role: "H1",
              children: [{ type: "content" }],
            },
            {
              role: "P",
              children: [{ type: "content" }],
            },
            {
              role: "P",
              children: [{ type: "content" }],
            },
          ],
        });
        const contentIds =
          structure?.children?.flatMap((child) => {
            const firstChild =
              "children" in child ? child.children?.[0] : undefined;
            return firstChild && "id" in firstChild ? [firstChild.id] : [];
          }) ?? [];
        expect(contentIds).toHaveLength(3);
        expect(new Set(contentIds).size).toBe(3);

        const text = await page.getTextContent({
          includeMarkedContent: true,
          disableNormalization: true,
        });
        expect(
          text.items
            .filter((item) => "str" in item && item.str)
            .map((item) => ("str" in item ? item.str : "")),
        ).toEqual([
          "Tagged research heading",
          "First tagged paragraph in reading order.",
          "Second tagged paragraph follows.",
        ]);

        const viewport = page.getViewport({ scale: 1 });
        const builder = new viewerRuntime.StructTreeLayerBuilder(
          page,
          viewport.rawDims,
        );
        const structureDom = (await builder.render()) as unknown;
        expect(structureDom).toBeInstanceOf(HTMLElement);
        const semanticNodes = Array.from(
          (structureDom as HTMLElement).children,
        ) as HTMLElement[];
        expect(
          semanticNodes.map((node) => [
            node.getAttribute("role"),
            node.getAttribute("aria-level"),
            node.getAttribute("aria-owns"),
          ]),
        ).toEqual([
          ["heading", "1", contentIds[0]],
          [null, null, contentIds[1]],
          [null, null, contentIds[2]],
        ]);
      } finally {
        page.cleanup();
      }
    } finally {
      await loadingTask.destroy();
    }
  });
});
