import { exportPdf, revealInDir, writeBytesFile } from "@/lib/tauri";
import { pickSavePath } from "@/lib/native-file-dialog";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { notifyError, toast } from "@/lib/toast";

/** Show in Finder/Explorer; never flip a successful save into a failure toast. */
function revealExportedFile(dest: string): void {
  void revealInDir(dest).catch(() => {
    toast.info(
      "File was saved, but Oleafly could not open its folder (permission denied). Check the location you chose in the save dialog.",
    );
  });
}

function exportSuccessToast(kind: "PDF" | "PNG", dest: string): void {
  const fileName = dest.split(/[/\\]/).pop() || kind.toLowerCase();
  toast.success(
    `${kind} saved · ${fileName}`,
    { label: "Show in folder", onClick: () => revealExportedFile(dest) },
    true,
  );
}

export async function exportCurrentPdf(): Promise<void> {
  const { projectId, projectName } = useFilesStore.getState();
  const { pdfBytes } = useCompileStore.getState();
  if (!projectId || !pdfBytes) return;
  const name = (projectName || "document").replace(/[^\w.-]+/g, "_");
  const dest = await pickSavePath({
    defaultPath: `${name}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!dest) return;
  try {
    await exportPdf(projectId, dest);
    // Destination path is known and the file was published — always success.
    exportSuccessToast("PDF", dest);
  } catch (e) {
    const detail = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    notifyError(
      "export pdf",
      e,
      detail ? `Couldn't save the PDF: ${detail}` : "Couldn't save the PDF",
    );
  }
}

// For image projects, where the output is an image rather than a document.
export async function exportCurrentImagePng(scale = 3): Promise<void> {
  const { projectName } = useFilesStore.getState();
  const { pdfBytes } = useCompileStore.getState();
  if (!pdfBytes) return;
  const name = (projectName || "figure").replace(/[^\w.-]+/g, "_");
  const dest = await pickSavePath({
    defaultPath: `${name}.png`,
    filters: [{ name: "PNG image", extensions: ["png"] }],
  });
  if (!dest) return;
  try {
    const { pdfPageToPng } = await import("@/lib/pdf-image");
    const dataUrl = await pdfPageToPng(pdfBytes, 1, scale);
    await writeBytesFile(dest, dataUrl.slice(dataUrl.indexOf(",") + 1));
    exportSuccessToast("PNG", dest);
  } catch (e) {
    const detail = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    notifyError(
      "export png",
      e,
      detail ? `Couldn't save the PNG: ${detail}` : "Couldn't save the PNG",
    );
  }
}
