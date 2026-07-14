import { save } from "@tauri-apps/plugin-dialog";
import { exportPdf, revealInDir, writeBytesFile } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { notifyError, toast } from "@/lib/toast";
import { pdfPageToPng } from "@/lib/pdf-image";

export async function exportCurrentPdf(): Promise<void> {
  const { projectId, projectName } = useFilesStore.getState();
  const { pdfBytes } = useCompileStore.getState();
  if (!projectId || !pdfBytes) return;
  const name = (projectName || "document").replace(/[^\w.-]+/g, "_");
  const dest = await save({
    defaultPath: `${name}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!dest) return;
  try {
    await exportPdf(projectId, dest);
    toast.success(
      "Export PDF complete",
      { label: "View File", onClick: () => void revealInDir(dest) },
      true,
    );
  } catch (e) {
    notifyError("export pdf", e, "Couldn't save the PDF");
  }
}

// For image projects, where the output is an image rather than a document.
export async function exportCurrentImagePng(scale = 3): Promise<void> {
  const { projectName } = useFilesStore.getState();
  const { pdfBytes } = useCompileStore.getState();
  if (!pdfBytes) return;
  const name = (projectName || "figure").replace(/[^\w.-]+/g, "_");
  const dest = await save({
    defaultPath: `${name}.png`,
    filters: [{ name: "PNG image", extensions: ["png"] }],
  });
  if (!dest) return;
  try {
    const dataUrl = await pdfPageToPng(pdfBytes, 1, scale);
    await writeBytesFile(dest, dataUrl.slice(dataUrl.indexOf(",") + 1));
    toast.success(
      "Export PNG complete",
      { label: "View File", onClick: () => void revealInDir(dest) },
      true,
    );
  } catch (e) {
    notifyError("export png", e, "Couldn't save the PNG");
  }
}
