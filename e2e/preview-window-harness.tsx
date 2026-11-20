import { PDFDocument, StandardFonts } from "pdf-lib";
import { createRoot } from "react-dom/client";
import "/packages/preview/src/polyfills";
import { PreviewWindow } from "/src/components/preview/PreviewWindow";
import { prepareHarnessI18n } from "./harness-i18n";
import "/src/styles/globals.css";

async function figurePng(): Promise<Uint8Array> {
  const canvas = window.document.createElement("canvas");
  canvas.width = 120;
  canvas.height = 80;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("the harness needs a 2D canvas to draw its figure");
  const colours = ["#d62828", "#2a9d8f", "#264de4", "#f4a261"];
  colours.forEach((colour, index) => {
    context.fillStyle = colour;
    context.fillRect((index % 2) * 60, Math.floor(index / 2) * 40, 60, 40);
  });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("the harness could not encode its figure");
  return new Uint8Array(await blob.arrayBuffer());
}

async function makeFixture(pageCount: number, withFigure: boolean): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const figure = withFigure ? await document.embedPng(await figurePng()) : null;
  for (let index = 1; index <= pageCount; index++) {
    const page = document.addPage([612, 792]);
    page.drawText(`Detached preview page ${index}`, {
      x: 72,
      y: 700,
      size: 20,
      font,
    });
    if (figure) page.drawImage(figure, { x: 156, y: 396, width: 300, height: 200 });
  }
  return document.save({ useObjectStreams: false });
}

const root = document.getElementById("root");
if (!root) throw new Error("detached preview harness root is missing");

try {
  const search = new URLSearchParams(window.location.search);
  const requested = Number(search.get("pages") ?? "2");
  const pages = Math.max(1, Math.min(3, Math.floor(requested) || 2));
  const bytes = await makeFixture(pages, search.get("figure") === "1");
  await prepareHarnessI18n();
  createRoot(root).render(
    <PreviewWindow harnessBytes={bytes} disableNativeBridge />,
  );
  document.body.dataset.fixtureState = "mounted";
  document.body.dataset.fixturePages = String(pages);
} catch (error) {
  document.body.dataset.fixtureState = "error";
  document.body.dataset.fixtureError = String(error);
  throw error;
}
