// @vitest-environment node

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { degrees, PDFDocument, PDFHeader, PDFName, PDFString, StandardFonts } from "pdf-lib";
import type { PdfFacts } from "@oleafly/preflight";
import { byCodePoint, expectGolden, PREFLIGHT_FIXTURES, REPO, WRITE } from "./support";

// PDF facts read by pdf.js, the reader the app uses. crates/oleafly-preflight
// reads the same files with lopdf and compares against this golden.

vi.mock("pdfjs-dist", async () => await import("pdfjs-dist/legacy/build/pdf.mjs"));

const PDF_DIR = path.join(PREFLIGHT_FIXTURES, "pdf");
const GOLDEN = path.join(PREFLIGHT_FIXTURES, "expected", "pdf-facts.json");

let extractForPreflight: typeof import("@oleafly/preflight/pdf-extract").extractForPreflight;

beforeAll(async () => {
  vi.stubGlobal("DOMMatrix", class DOMMatrix {});
  vi.stubGlobal("ImageData", class ImageData {});
  vi.stubGlobal("Path2D", class Path2D {});
  ({ extractForPreflight } = await import("@oleafly/preflight/pdf-extract"));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const resolve = createRequire(import.meta.url).resolve;
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href;
}, 60_000);

async function twoSizesLinksOutline(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  // Older header than IEEE's 1.4 minimum, so the version rule has something to report.
  (doc.context as unknown as { header: PDFHeader }).header = PDFHeader.forVersion(1, 3);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const letter = doc.addPage([612, 792]);
  letter.drawText("Letter page", { x: 72, y: 700, size: 12, font });
  const a4 = doc.addPage([595, 842]);
  a4.drawText("A4 page", { x: 72, y: 760, size: 12, font });
  const link = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [72, 690, 200, 712],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of("https://example.com") },
    }),
  );
  letter.node.set(PDFName.of("Annots"), doc.context.obj([link]));
  const outlines = doc.context.nextRef();
  const first = doc.context.nextRef();
  const second = doc.context.nextRef();
  doc.context.assign(
    first,
    doc.context.obj({ Title: PDFString.of("Letter"), Parent: outlines, Next: second, Dest: [letter.ref, PDFName.of("Fit")] }),
  );
  doc.context.assign(
    second,
    doc.context.obj({ Title: PDFString.of("A4"), Parent: outlines, Prev: first, Dest: [a4.ref, PDFName.of("Fit")] }),
  );
  doc.context.assign(outlines, doc.context.obj({ Type: "Outlines", First: first, Last: second, Count: 2 }));
  doc.catalog.set(PDFName.of("Outlines"), outlines);
  doc.setAuthor("Ana Example");
  doc.setProducer("Oleafly golden fixture");
  return doc.save({ useObjectStreams: false });
}

async function rotatedAttachment(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Courier);
  const page = doc.addPage([612, 792]);
  page.setRotation(degrees(90));
  page.setCropBox(50, 50, 400, 600);
  page.drawText("Rotated page", { x: 100, y: 300, size: 12, font });
  // Copied into this realm's Uint8Array: under jsdom, TextEncoder's comes
  // from another realm and pdf-lib's instanceof check refuses it.
  await doc.attach(new Uint8Array(new TextEncoder().encode("a,b\n1,2\n")), "data.csv", {
    mimeType: "text/csv",
    description: "Data",
  });
  doc.setCreator("Oleafly golden fixture");
  return doc.save({ useObjectStreams: false });
}

// A TrueType font embedded as FontFile2, the way LaTeX's output embeds every
// font: the app and the CLI must both read it as embedded.
async function embeddedFont(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const ttf = new Uint8Array(
    fs.readFileSync(path.join(REPO, "node_modules/katex/dist/fonts/KaTeX_Caligraphic-Regular.ttf")),
  );
  const fontFile = doc.context.register(doc.context.flateStream(ttf, { Length1: ttf.length }));
  const descriptor = doc.context.register(
    doc.context.obj({
      Type: "FontDescriptor",
      FontName: "OleaflyFixtureSerif",
      Flags: 32,
      FontBBox: [0, -250, 1000, 750],
      ItalicAngle: 0,
      Ascent: 750,
      Descent: -250,
      CapHeight: 700,
      StemV: 80,
      FontFile2: fontFile,
    }),
  );
  const font = doc.context.register(
    doc.context.obj({
      Type: "Font",
      Subtype: "TrueType",
      BaseFont: "OleaflyFixtureSerif",
      FirstChar: 65,
      LastChar: 67,
      Widths: [700, 700, 700],
      Encoding: "WinAnsiEncoding",
      FontDescriptor: descriptor,
    }),
  );
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream("BT /F1 24 Tf 72 700 Td (ABC) Tj ET")));
  page.node.set(PDFName.of("Resources"), doc.context.obj({ Font: { F1: font } }));
  return doc.save({ useObjectStreams: false });
}

// A file attached the way `\attachfile` does it: in a FileAttachment
// annotation, not in the catalog's EmbeddedFiles tree.
async function fileAttachmentAnnotation(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([612, 792]);
  const data = new Uint8Array(new TextEncoder().encode("a,b\n1,2\n"));
  const file = doc.context.register(doc.context.flateStream(data, { Type: "EmbeddedFile" }));
  const spec = doc.context.obj({ Type: "Filespec", F: PDFString.of("data.csv"), EF: { F: file } });
  const annotation = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "FileAttachment",
      Rect: [72, 700, 92, 720],
      FS: spec,
      Contents: PDFString.of("Data"),
      Name: "Paperclip",
    }),
  );
  page.node.set(PDFName.of("Annots"), doc.context.obj([annotation]));
  return doc.save({ useObjectStreams: false });
}

const BUILDERS: Record<string, () => Promise<Uint8Array>> = {
  "two-sizes-links-outline.pdf": twoSizesLinksOutline,
  "rotated-attachment.pdf": rotatedAttachment,
  "embedded-font.pdf": embeddedFont,
  "file-attachment-annotation.pdf": fileAttachmentAnnotation,
};

function normalized(facts: PdfFacts): PdfFacts {
  return {
    ...facts,
    pages: facts.pages.map((page) => ({
      ...page,
      width: Math.round(page.width * 10) / 10,
      height: Math.round(page.height * 10) / 10,
    })),
    fonts: [...facts.fonts].sort((left, right) => byCodePoint(left.name, right.name)),
  };
}

describe("PDF facts golden", () => {
  it("matches the committed golden", async () => {
    if (WRITE) {
      fs.mkdirSync(PDF_DIR, { recursive: true });
      for (const [name, build] of Object.entries(BUILDERS)) {
        fs.writeFileSync(path.join(PDF_DIR, name), await build());
      }
    }
    const out: Record<string, PdfFacts> = {};
    for (const name of Object.keys(BUILDERS).sort(byCodePoint)) {
      const file = path.join(PDF_DIR, name);
      expect(fs.existsSync(file), `${name} is missing; run with OLEAFLY_WRITE_GOLDENS=1`).toBe(true);
      const extracted = await extractForPreflight(new Uint8Array(fs.readFileSync(file)));
      out[name] = normalized(extracted.facts);
    }
    expectGolden(GOLDEN, out);
  }, 60_000);
});
