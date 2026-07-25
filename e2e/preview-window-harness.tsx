import { PDFDocument, StandardFonts } from "pdf-lib";
import { createRoot } from "react-dom/client";
import "/packages/preview/src/polyfills";
import { PreviewWindow } from "/src/components/preview/PreviewWindow";
import "/src/styles/globals.css";

async function makeFixture(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= pageCount; index++) {
    const page = document.addPage([612, 792]);
    page.drawText(`Detached preview page ${index}`, {
      x: 72,
      y: 700,
      size: 20,
      font,
    });
  }
  return document.save({ useObjectStreams: false });
}

const root = document.getElementById("root");
if (!root) throw new Error("detached preview harness root is missing");

try {
  const requested = Number(new URLSearchParams(window.location.search).get("pages") ?? "2");
  const pages = Math.max(1, Math.min(3, Math.floor(requested) || 2));
  const bytes = await makeFixture(pages);
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
