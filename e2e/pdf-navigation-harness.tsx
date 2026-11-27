import "/packages/preview/src/polyfills";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PreviewPane } from "/src/components/preview/PreviewPane";
import { useCompileStore } from "/src/store/compile";
import { useFilesStore } from "/src/store/files";
import { useProjectAnalysisStore } from "/src/store/project-analysis";
import { prepareHarnessI18n } from "./harness-i18n";
import "/src/styles/globals.css";

async function fixture(): Promise<Uint8Array> {
  // Playwright can serve a private reproduction PDF without copying it into
  // the repository or uploading it. The default fixture is generated locally.
  if (new URLSearchParams(location.search).has("external")) {
    const response = await fetch("/e2e/navigation-fixture.pdf");
    if (!response.ok) throw new Error(`PDF fixture: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= 79; number++) {
    const page = document.addPage([612, 792]);
    page.drawText(`Navigation fixture page ${number}`, { x: 72, y: 700, size: 20, font });
  }
  return document.save();
}

try {
  await prepareHarnessI18n();
  const bytes = await fixture();
  const projectId = "pdf-navigation-fixture";
  useProjectAnalysisStore.getState().activateProject({
    projectId,
    projectRevision: 2,
    languageServiceGeneration: 0,
  });
  useFilesStore.setState({
    projectId,
    projectName: "PDF navigation",
    projectKind: "",
    mainDoc: "main.tex",
    engineLoaded: true,
  });
  useCompileStore.setState({
    status: "success",
    phase: "idle",
    pdfBytes: bytes,
    errors: [],
    failureReason: null,
    lastAttemptIdentity: null,
    lastCompileCheckpoint: {
      version: 1,
      projectId,
      mainDocument: "main.tex",
      projectRevision: 2,
      requestGeneration: 1,
      outputKind: "standard",
      producerId: "test",
      outputRevision: 1,
      outputId: "navigation-pdf",
      completedAt: 1,
    },
  });
  const root = document.getElementById("root");
  if (!root) throw new Error("PDF navigation harness root is missing");
  createRoot(root).render(
    <StrictMode>
      <div style={{ width: 900, height: 800 }}><PreviewPane /></div>
    </StrictMode>,
  );
  document.body.dataset.fixtureState = "mounted";
} catch (error) {
  document.body.dataset.fixtureState = "error";
  document.body.dataset.fixtureError = String(error);
  throw error;
}
