import { PDFDocument, StandardFonts } from "pdf-lib";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "/packages/preview/src/polyfills";
import { PdfViewer } from "/packages/preview/src/PdfViewer";
import "/src/styles/globals.css";

async function makeSelectionFixture(): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  page.drawText("Cross-span start ", {
    x: 72,
    y: 700,
    size: 18,
    font,
  });
  page.drawText("continues here", {
    x: 218,
    y: 700,
    size: 18,
    font,
  });
  page.drawText("and reaches another line", {
    x: 72,
    y: 660,
    size: 18,
    font,
  });
  page.drawText("Production PdfViewer evidence", {
    x: 72,
    y: 610,
    size: 12,
    font,
  });
  return document.save({ useObjectStreams: false });
}

function Harness({ bytes }: { bytes: Uint8Array }) {
  return (
    <main
      id="pdf-viewport"
      aria-label="Production PDF selection fixture"
      style={{
        width: "900px",
        height: "900px",
        overflow: "auto",
        background: "#e7e7e7",
      }}
    >
      <PdfViewer data={bytes} scale={1} expectText />
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("PDF harness root is missing");

try {
  const bytes = await makeSelectionFixture();
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
