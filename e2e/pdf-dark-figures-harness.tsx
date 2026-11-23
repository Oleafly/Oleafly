import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "/packages/preview/src/polyfills";
import { PdfViewer } from "/packages/preview/src/PdfViewer";
import { prepareHarnessI18n } from "./harness-i18n";
import "/src/styles/globals.css";

const PHOTO_COLORS = [
  [200, 40, 40],
  [40, 160, 70],
  [40, 80, 200],
  [220, 160, 30],
] as const;

const SCANNED_PAPER = [245, 244, 236] as const;

async function png(width: number, height: number, paint: (context: CanvasRenderingContext2D) => void): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Harness canvas has no 2D context");
  paint(context);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Harness canvas did not encode a PNG");
  return new Uint8Array(await blob.arrayBuffer());
}

function solid([red, green, blue]: readonly [number, number, number]) {
  return (context: CanvasRenderingContext2D) => {
    context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  };
}

async function vectorFigure(): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([300, 200]);
  page.drawRectangle({ x: 0, y: 0, width: 300, height: 200, color: rgb(1, 1, 1) });
  page.drawLine({ start: { x: 30, y: 30 }, end: { x: 290, y: 30 }, thickness: 1.5, color: rgb(0, 0, 0) });
  page.drawLine({ start: { x: 30, y: 30 }, end: { x: 30, y: 190 }, thickness: 1.5, color: rgb(0, 0, 0) });
  const curve = [
    [30, 50],
    [80, 110],
    [130, 140],
    [180, 160],
    [230, 168],
    [280, 172],
  ];
  for (let index = 1; index < curve.length; index++) {
    const [fromX, fromY] = curve[index - 1];
    const [toX, toY] = curve[index];
    page.drawLine({ start: { x: fromX, y: fromY }, end: { x: toX, y: toY }, thickness: 3, color: rgb(0.12, 0.47, 0.71) });
  }
  page.drawRectangle({ x: 200, y: 31, width: 20, height: 60, color: rgb(1, 0.5, 0.05) });
  page.drawRectangle({ x: 230, y: 31, width: 20, height: 90, color: rgb(0.17, 0.63, 0.17) });
  page.drawText("accuracy", { x: 36, y: 180, size: 11, font, color: rgb(0, 0, 0) });
  return document.save({ useObjectStreams: false });
}

function caption(page: PDFPage, font: PDFFont, title: string) {
  page.drawText(title, { x: 72, y: 740, size: 16, font });
  for (let line = 0; line < 4; line++) {
    page.drawText("Body text recolored for the dark page, as before.", { x: 72, y: 700 - line * 16, size: 11, font });
  }
}

async function makeFigureFixture(): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const [figure] = await document.embedPdf(await vectorFigure());
  const photos = await Promise.all(PHOTO_COLORS.map(async (color) => document.embedPng(await png(64, 48, solid(color)))));
  const fullBleed = await document.embedPng(
    await png(306, 340, (context) => {
      solid(PHOTO_COLORS[2])(context);
      context.fillStyle = `rgb(${PHOTO_COLORS[3].join(", ")})`;
      context.fillRect(0, 0, 306, 120);
    }),
  );
  const scan = await document.embedPng(
    await png(306, 396, (context) => {
      solid(SCANNED_PAPER)(context);
      context.fillStyle = "rgb(30, 30, 30)";
      for (let y = 40; y < 360; y += 12) {
        for (let x = 36, word = 0; x < 260; word++) {
          const width = 12 + ((word * 7 + y) % 5) * 6;
          context.fillRect(x, y, Math.min(width, 270 - x), 4);
          x += width + 5;
        }
      }
    }),
  );

  const vector = document.addPage([612, 792]);
  caption(vector, font, "An included vector figure");
  vector.drawPage(figure, { x: 156, y: 400, width: 300, height: 200 });

  const grid = document.addPage([612, 792]);
  caption(grid, font, "Forty separate photos");
  for (let index = 0; index < 40; index++) {
    const x = 72 + (index % 8) * 60;
    const y = 560 - Math.floor(index / 8) * 46;
    grid.drawImage(photos[index % photos.length], { x, y, width: 56, height: 42 });
  }

  const bleed = document.addPage([612, 792]);
  bleed.drawImage(fullBleed, { x: 0, y: 56, width: 612, height: 680 });

  const scanned = document.addPage([612, 792]);
  scanned.drawImage(scan, { x: 0, y: 0, width: 612, height: 792 });

  const faded = document.addPage([612, 792]);
  caption(faded, font, "A figure drawn at half opacity");
  faded.drawPage(figure, { x: 156, y: 400, width: 300, height: 200, opacity: 0.5 });

  return document.save({ useObjectStreams: false });
}

function Harness({ bytes }: { bytes: Uint8Array }) {
  return (
    <main
      id="pdf-viewport"
      aria-label="PDF dark mode figures fixture"
      style={{ width: "900px", height: "900px", overflow: "auto", background: "#202020" }}
    >
      <PdfViewer data={bytes} scale={1} pageColors="dark" expectText />
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("PDF harness root is missing");

try {
  const bytes = await makeFigureFixture();
  await prepareHarnessI18n();
  createRoot(rootElement).render(
    <StrictMode>
      <Harness bytes={bytes} />
    </StrictMode>,
  );
  document.body.dataset.fixtureState = "mounted";
} catch (error) {
  document.body.dataset.fixtureState = "error";
  document.body.dataset.fixtureError = String(error);
  throw error;
}
