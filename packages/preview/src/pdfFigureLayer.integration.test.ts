// @vitest-environment node

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pdfFigureBoxes, rememberPdfFigures } from "./pdfFigureLayer";

type PdfJs = typeof import("pdfjs-dist");
type PdfPage = Awaited<ReturnType<Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>["getPage"]>>;
type NodeCanvas = { createCanvas(width: number, height: number): { getContext(kind: "2d"): unknown } };
type Box = [left: number, top: number, right: number, bottom: number];

const CANVAS_GLOBALS = ["DOMMatrix", "ImageData", "Path2D"] as const;

const FIGURE = "0 0 1 rg 0 0 100 60 re f 1 0 0 rg 10 10 30 20 re f 0 1 0 rg 60 30 30 20 re f";
const PIXELS = "BI /W 2 /H 2 /CS /RGB /BPC 8 /F /AHx ID ff000000ff000000ffffff00> EI";
const MASK = `1 g 0 0 100 60 re f 0.5 g 0 0 50 30 re f q 50 0 0 30 10 10 cm ${PIXELS} Q`;
const lines = (count: number, size: number, x: number, top: number) =>
  `BT /Bx ${size} Tf ${x} ${top} Td ${Array.from({ length: count }, () => `(AAAA) Tj 0 -${size} Td`).join(" ")} ET`;
const SHADING = "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> >>";

let pdfjs: PdfJs;
let canvases: NodeCanvas;
let installed: string[] = [];
let standardFontDataUrl = "";

beforeAll(async () => {
  await import("./polyfills");
  const pdfjsEntry = createRequire(import.meta.url).resolve("pdfjs-dist");
  standardFontDataUrl = `${join(dirname(dirname(pdfjsEntry)), "standard_fonts")}/`;
  const fromPdfjs = createRequire(pdfjsEntry);
  const napi = fromPdfjs("@napi-rs/canvas") as NodeCanvas & Record<string, unknown>;
  canvases = napi;
  const scope = globalThis as Record<string, unknown>;
  installed = CANVAS_GLOBALS.filter((name) => scope[name] === undefined);
  for (const name of installed) scope[name] = napi[name];
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    pdfjs = await import("pdfjs-dist");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import("pdfjs-dist/build/pdf.worker.min.mjs");
  } finally {
    log.mockRestore();
  }
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, "pdfjsWorker");
  for (const name of installed) Reflect.deleteProperty(globalThis, name);
});

function stream(dictionary: string, content: string): string {
  return `<< ${dictionary} /Length ${content.length} >>\nstream\n${content}\nendstream`;
}

function buildPdf(pages: readonly { content: string; resources: string; annots?: string }[], shared: readonly string[], catalog = "") {
  const objects: string[] = [`<< /Type /Catalog /Pages 2 0 R${catalog} >>`, ""];
  const kids: string[] = [];
  const first = 3 + shared.length;
  objects.push(...shared);
  pages.forEach((page, index) => {
    const at = first + index * 2;
    kids.push(`${at} 0 R`);
    const annots = page.annots ? ` /Annots [${page.annots}]` : "";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources ${page.resources} /Contents ${at + 1} 0 R${annots} >>`,
      stream("", page.content),
    );
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  let body = "%PDF-1.7\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

const FIG = 3;
const GROUP_FIG = 4;
const MASK_FORM = 5;
const FADE = 6;
const ISOLATED_FIG = 7;
const STAMP = 8;
const HALF = 9;
const SQUARE = 10;
const SCALED_GROUP = 11;
const MULTIPLY = 12;
const ONE_STROKE = 13;
const SHADE = 14;
const GLYPH = 15;
const TYPE3 = 16;
const ONE_FILL_GROUP = 17;
const CLIPPED_PAIR = 18;
const GLYPH_BOX = 19;
const BOX_FONT = 20;
const TEXT_BLOCK = 21;
const LABELLED = 22;
const WRAPPED_PAGE = 23;
const SLIDE_PAGE = 24;
const LOOSE = 25;
const HIDDEN = 26;
const LAYER = 27;
const OCR = 28;
const LOOSE_TYPE3 = 29;
const SHADED_PAIR = 30;
const SCALED_SLIDE = 31;
const OWN_FONTS = `/Font << /Bx ${BOX_FONT} 0 R >>`;
const PHOTOS = [
  [160, 80],
  [175, 80],
  [160, 65],
  [175, 65],
  [160, 50],
] as const;
const LOOSE_FIGURE = "q 1 0 0 1 120 20 cm 0 0 1 rg 0 0 40 30 re f 1 0 0 rg 5 5 10 10 re f 0 1 0 rg 20 5 10 10 re f Q";

const SHARED = [
  stream("/Type /XObject /Subtype /Form /BBox [0 0 100 60]", FIGURE),
  stream("/Type /XObject /Subtype /Form /BBox [0 0 100 60] /Group << /S /Transparency /CS /DeviceRGB >>", FIGURE),
  stream("/Type /XObject /Subtype /Form /BBox [0 0 100 60] /Group << /S /Transparency /CS /DeviceGray >>", MASK),
  `<< /Type /ExtGState /SMask << /Type /Mask /S /Luminosity /G ${MASK_FORM} 0 R >> >>`,
  stream(
    `/Type /XObject /Subtype /Form /BBox [0 0 100 60] /Group << /S /Transparency /I true /CS /DeviceRGB >> /Resources << /ExtGState << /Fade ${FADE} 0 R >> >>`,
    `q /Fade gs 0 g 0 0 100 10 re f Q 0 0 1 rg 0 50 100 10 re f q 60 0 0 40 20 15 cm ${PIXELS} Q`,
  ),
  stream(`/Type /XObject /Subtype /Form /BBox [0 0 30 30] /Resources << /XObject << /Fig ${FIG} 0 R >> >>`, "/Fig Do"),
  "<< /Type /ExtGState /ca 0.5 /CA 0.5 >>",
  `<< /Type /Annot /Subtype /Square /Rect [10 10 40 40] /AP << /N ${STAMP} 0 R >> >>`,
  stream("/Type /XObject /Subtype /Form /BBox [0 0 100 60] /Matrix [0.5 0 0 0.5 0 0] /Group << /S /Transparency /CS /DeviceRGB >>", FIGURE),
  "<< /Type /ExtGState /BM /Multiply >>",
  stream("/Type /XObject /Subtype /Form /BBox [0 0 100 60]", "0 0 1 RG 4 w 0 0 m 100 60 l S"),
  stream(`/Type /XObject /Subtype /Form /BBox [0 0 100 60] /Resources << /Shading << /Sh0 ${SHADING} >> >>`, "/Sh0 sh"),
  stream("", "1000 0 d0 q 10 0 0 10 0 0 cm /Fig Do Q"),
  `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 600] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /g ${GLYPH} 0 R >> /Encoding << /Type /Encoding /Differences [65 /g] >> /FirstChar 65 /LastChar 65 /Widths [1000] /Resources << /XObject << /Fig ${FIG} 0 R >> >> >>`,
  stream("/Type /XObject /Subtype /Form /BBox [0 0 100 60] /Group << /S /Transparency /CS /DeviceRGB >>", "0 0 1 rg 0 0 100 60 re f"),
  stream("/Type /XObject /Subtype /Form /BBox [0 0 100 60]", "0 0 100 60 re W n 1 0 0 rg 10 10 30 20 re f 0 1 0 rg 60 30 30 20 re f"),
  stream("", "1000 0 d0 0 0 600 700 re f"),
  `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /g ${GLYPH_BOX} 0 R >> /Encoding << /Type /Encoding /Differences [65 /g] >> /FirstChar 65 /LastChar 65 /Widths [1000] >>`,
  stream(`/Type /XObject /Subtype /Form /BBox [0 0 100 60] /Resources << ${OWN_FONTS} >>`, `${lines(5, 6, 5, 50)} 0 0 1 rg 5 5 90 1 re f`),
  stream(`/Type /XObject /Subtype /Form /BBox [0 0 100 60] /Resources << ${OWN_FONTS} >>`, `${FIGURE} BT /Bx 6 Tf 10 52 Td (AA) Tj 60 0 Td (AA) Tj ET`),
  stream(
    `/Type /XObject /Subtype /Form /BBox [0 0 200 100] /Resources << ${OWN_FONTS} /XObject << /Fig ${FIG} 0 R >> >>`,
    `${lines(16, 6, 5, 96)} q 0.5 0 0 0.5 100 10 cm /Fig Do Q q 0.5 0 0 0.5 100 60 cm /Fig Do Q ${PHOTOS.map(([x, y]) => `q 10 0 0 10 ${x} ${y} cm ${PIXELS} Q`).join(" ")}`,
  ),
  stream(
    `/Type /XObject /Subtype /Form /BBox [0 0 200 100] /Resources << /XObject << /Fig ${FIG} 0 R >> >>`,
    "0.9 0.9 1 rg 0 0 200 100 re f q 0.5 0 0 0.5 20 20 cm /Fig Do Q 1 0 0 rg 150 10 30 20 re f 0 0 1 rg 150 40 30 20 re f",
  ),
  stream(
    "/Type /XObject /Subtype /Form /BBox [0 0 200 100] /Resources << /Font << /H << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>",
    `${LOOSE_FIGURE} BT /H 10 Tf 150 70 Td (Label) Tj ET`,
  ),
  stream(`/Type /XObject /Subtype /Form /BBox [0 0 100 60] /Resources << /Properties << /off ${LAYER} 0 R >> >>`, `/OC /off BDC ${FIGURE} EMC`),
  "<< /Type /OCG /Name (Hidden) >>",
  stream(`/Type /XObject /Subtype /Form /BBox [0 0 100 60] /Resources << ${OWN_FONTS} >>`, `3 Tr ${lines(6, 6, 5, 50)} 0 Tr 0 0 1 rg 0 0 100 2 re f 0 58 100 2 re f`),
  stream(`/Type /XObject /Subtype /Form /BBox [0 0 200 100] /Resources << ${OWN_FONTS} >>`, `${LOOSE_FIGURE} BT /Bx 10 Tf 150 70 Td (AAAA) Tj ET`),
  stream(
    `/Type /XObject /Subtype /Form /BBox [0 0 100 60] /Resources << /Shading << /Sh0 ${SHADING} >> >>`,
    "/Sh0 sh 1 0 0 rg 10 10 30 20 re f 0 1 0 rg 60 30 30 20 re f",
  ),
  stream(
    "/Type /XObject /Subtype /Form /BBox [0 0 400 200] /Matrix [0.5 0 0 0.5 0 0] /Group << /S /Transparency /CS /DeviceRGB >>",
    "0 0 1 rg 100 50 100 60 re f 1 0 0 rg 120 60 20 20 re f 0 1 0 rg 160 60 20 20 re f",
  ),
];
const CATALOG = ` /OCProperties << /OCGs [${LAYER} 0 R] /D << /OFF [${LAYER} 0 R] >> >>`;

const RESOURCES = `<< /XObject << /Fig ${FIG} 0 R /GroupFig ${GROUP_FIG} 0 R /IsolatedFig ${ISOLATED_FIG} 0 R /ScaledGroup ${SCALED_GROUP} 0 R /OneStroke ${ONE_STROKE} 0 R /Shade ${SHADE} 0 R /OneFillGroup ${ONE_FILL_GROUP} 0 R /ClippedPair ${CLIPPED_PAIR} 0 R /TextBlock ${TEXT_BLOCK} 0 R /Labelled ${LABELLED} 0 R /WrappedPage ${WRAPPED_PAGE} 0 R /SlidePage ${SLIDE_PAGE} 0 R /Loose ${LOOSE} 0 R /Hidden ${HIDDEN} 0 R /Ocr ${OCR} 0 R /LooseType3 ${LOOSE_TYPE3} 0 R /ShadedPair ${SHADED_PAIR} 0 R /ScaledSlide ${SCALED_SLIDE} 0 R >> /ExtGState << /Half ${HALF} 0 R /Fade ${FADE} 0 R /Mul ${MULTIPLY} 0 R >> /Font << /T3 ${TYPE3} 0 R >> >>`;

const PAGES = [
  { content: `q 1 0 0 1 50 30 cm /Fig Do Q q 20 0 0 20 160 70 cm ${PIXELS} Q`, resources: RESOURCES },
  {
    content:
      "q 1 0 0 1 0 0 cm /GroupFig Do Q q /Half gs 1 0 0 1 100 40 cm /GroupFig Do Q q /Mul gs 1 0 0 1 100 0 cm /Fig Do Q q 1 0 0 1 100 0 cm /OneFillGroup Do Q q 0.5 0 0 0.5 140 0 cm /Fig Do Q",
    resources: RESOURCES,
  },
  { content: "q 1 0 0 1 50 30 cm /IsolatedFig Do Q", resources: RESOURCES },
  { content: "q 60 40 50 30 re W n 1 0 0 1 50 30 cm /Fig Do Q", resources: RESOURCES },
  {
    content: "q /Fade gs 0 0 1 rg 120 20 60 50 re f Q q 1 0 0 1 50 0 cm /OneStroke Do Q q 1 0 0 1 50 40 cm /Shade Do Q q 1 0 0 1 0 0 cm /ClippedPair Do Q q 1 0 0 1 100 0 cm /ShadedPair Do Q BT /T3 40 Tf 20 60 Td (A) Tj ET",
    resources: RESOURCES,
    annots: `${SQUARE} 0 R`,
  },
  { content: "q 0.5 0 0 0.5 10 20 cm /Fig Do Q q 0.5 0 0 0.5 120 20 cm /Fig Do Q q 1 0 0 1 0 0 cm /ScaledGroup Do Q", resources: RESOURCES },
  { content: "q 1 0 0 1 0 40 cm /TextBlock Do Q q 1 0 0 1 100 0 cm /Labelled Do Q", resources: RESOURCES },
  { content: "q 1 0 0 1 0 0 cm /WrappedPage Do Q", resources: RESOURCES },
  { content: "q 1 0 0 1 0 0 cm /SlidePage Do Q", resources: RESOURCES },
  { content: "q 1 0 0 1 0 0 cm /Hidden Do Q q 1 0 0 1 100 40 cm /Ocr Do Q", resources: RESOURCES },
  { content: "q 0.5 0 0 0.5 0 0 cm /Loose Do Q q 0.5 0 0 0.5 100 50 cm /LooseType3 Do Q", resources: RESOURCES },
  { content: "q 1 0 0 1 0 0 cm /ScaledSlide Do Q", resources: RESOURCES },
];

function boxes(coordinates: ArrayLike<number> | null | undefined): Box[] {
  const found: Box[] = [];
  for (let at = 0; coordinates && at + 5 < coordinates.length; at += 6) {
    const [ax, ay, bx, by, cx, cy] = Array.from({ length: 6 }, (_, index) => coordinates[at + index]);
    const xs = [ax, bx, cx, bx + cx - ax];
    const ys = [ay, by, cy, by + cy - ay];
    found.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }
  return found;
}

function expectBoxes(actual: readonly Box[], expected: readonly Box[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((box, index) => {
    box.forEach((edge, side) => expect(edge).toBeCloseTo(expected[index][side], 2));
  });
}

async function recordedPages() {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    const task = pdfjs.getDocument({ data: buildPdf(PAGES, SHARED, CATALOG), verbosity: 0, standardFontDataUrl });
    const document = await task.promise;
    const pages: { page: PdfPage; images: Box[]; forms: Box[] }[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const canvas = canvases.createCanvas(viewport.width, viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport, recordImages: true } as never).promise;
      const recorded = page as unknown as { imageCoordinates: ArrayLike<number> | null; formCoordinates?: ArrayLike<number> | null };
      pages.push({ page, images: boxes(recorded.imageCoordinates), forms: boxes(recorded.formCoordinates) });
    }
    return { pages, destroy: () => task.destroy() };
  } finally {
    log.mockRestore();
  }
}

describe("pdf.js figure recording", () => {
  it("records included PDF figures as forms, and only figures drawn as they are printed", async () => {
    const { pages, destroy } = await recordedPages();
    try {
      const [plain, groups, isolated, clipped, effects, several] = pages;
      expectBoxes(plain.forms, [[0.25, 0.1, 0.75, 0.7]]);
      expectBoxes(plain.images, [[0.8, 0.1, 0.9, 0.3]]);
      expectBoxes(groups.forms, [
        [0, 0.4, 0.5, 1],
        [0.7, 0.7, 0.95, 1],
      ]);
      expectBoxes(isolated.forms, [[0.25, 0.1, 0.75, 0.7]]);
      expectBoxes(isolated.images, [[0.35, 0.15, 0.65, 0.55]]);
      expectBoxes(clipped.forms, [[0.3, 0.3, 0.55, 0.6]]);
      expect(effects.forms).toEqual([]);
      expect(effects.images).toEqual([]);
      expectBoxes(several.forms, [
        [0.05, 0.5, 0.3, 0.8],
        [0.6, 0.5, 0.85, 0.8],
        [0, 0.7, 0.25, 1],
      ]);
    } finally {
      await destroy();
    }
  });

  it("leaves text drawn as a form to the page, and keeps the figures and pictures inside it", async () => {
    const { pages, destroy } = await recordedPages();
    try {
      const [text, wrapped, slide, hidden] = pages.slice(6);
      expectBoxes(text.forms, [[0.5, 0.4, 1, 1]]);
      expectBoxes(wrapped.forms, [
        [0.5, 0.6, 0.75, 0.9],
        [0.5, 0.1, 0.75, 0.4],
      ]);
      expectBoxes(
        wrapped.images,
        PHOTOS.map(([x, y]) => [x / 200, (90 - y) / 100, (x + 10) / 200, (100 - y) / 100]),
      );
      expectBoxes(slide.forms, [
        [0, 0, 1, 1],
        [0.1, 0.5, 0.35, 0.8],
      ]);
      expect(hidden.forms).toEqual([]);
    } finally {
      await destroy();
    }
  });

  it("records what an included figure painted, labels included, not the whole box it declares", async () => {
    const { pages, destroy } = await recordedPages();
    try {
      const [helvetica, type3] = pages[10].forms;
      expect(pages[10].forms).toHaveLength(2);
      expect(helvetica[0]).toBeCloseTo(0.295, 2);
      expect(helvetica[3]).toBeCloseTo(0.91, 2);
      expect(helvetica[2]).toBeGreaterThan(0.425);
      expect(helvetica[2]).toBeLessThan(0.465);
      expect(helvetica[1]).toBeGreaterThan(0.57);
      expect(helvetica[1]).toBeLessThan(0.64);
      expectBoxes([type3], [[0.795, 0.105, 0.97, 0.41]]);
      expectBoxes(pages[11].forms, [[0, 0, 1, 1]]);
    } finally {
      await destroy();
    }
  });

  it("keeps one box for a picture drawn inside an included figure", async () => {
    const { pages, destroy } = await recordedPages();
    try {
      const { page } = pages[2];
      const viewport = page.getViewport({ scale: 1 });
      expect(rememberPdfFigures(page, viewport, viewport)).toBe(true);
      const [box, ...rest] = pdfFigureBoxes(page, viewport);
      expect(rest).toEqual([]);
      expectBoxes([[box.left, box.top, box.right, box.bottom]], [[0.25, 0.1, 0.75, 0.7]]);
    } finally {
      await destroy();
    }
  });
});
