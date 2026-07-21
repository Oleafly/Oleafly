// Regenerates the committed import fixtures. Run: node e2e/gen-fixtures.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { strToU8, zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const out = (name) => join(here, "fixture-files", name);

// A 64x64 red PNG (generated once with a canvas, embedded as base64).
const RED_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAOElEQVR42u3OMQEAAAgDoK1/aM3g4QcFaCbvKpFIJBKJRCKRSCQSiUQikUgkEolEIpFIJBLJpiXW5QG/aCsc/gAAAABJRU5ErkJggg==";

async function makePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Fixture Title", { x: 180, y: 740, size: 24, font: bold, color: rgb(0, 0, 0) });
  page.drawText("Introduction", { x: 72, y: 690, size: 16, font: bold });
  page.drawText("Deterministic import fixture body text for the converter.", {
    x: 72,
    y: 660,
    size: 11,
    font,
  });
  page.drawText("A second line keeps the paragraph assembly honest.", {
    x: 72,
    y: 645,
    size: 11,
    font,
  });
  const png = await doc.embedPng(Buffer.from(RED_PNG_B64, "base64"));
  page.drawImage(png, { x: 72, y: 500, width: 96, height: 96 });
  writeFileSync(out("tiny.pdf"), await doc.save());
}

function makeDocx() {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Docx fixture paragraph</w:t></w:r></w:p>
  </w:body>
</w:document>`;
  const zipped = zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "word/document.xml": strToU8(document),
  });
  writeFileSync(out("tiny.docx"), zipped);
}

await makePdf();
makeDocx();
console.log("fixtures written to e2e/fixture-files/");
