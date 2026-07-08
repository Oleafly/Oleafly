import { save } from "@tauri-apps/plugin-dialog";
import { exportPdf, revealInDir } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { notifyError, toast } from "@/lib/toast";

/** Open a save dialog and write the compiled PDF to the chosen path. */
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
