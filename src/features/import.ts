import { save } from "@tauri-apps/plugin-dialog";
import { strToU8, zipSync } from "fflate";
import type { ExtractedFigure } from "@oleafly/pdf-to-latex";
import { logError } from "@/lib/log";
import {
  createProject,
  createProjectFromDocx,
  saveFileBase64,
  writeBytesFile,
  writeFileContent,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useImportStore } from "@/store/import";

export function baseName(fileName: string): string {
  const last = fileName.split(/[\\/]/).pop() ?? fileName;
  const stripped = last.replace(/\.[^.]+$/, "");
  return stripped.length > 0 ? stripped : last;
}

export function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function zipEntries(tex: string, figures: ExtractedFigure[]): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = { "main.tex": strToU8(tex) };
  for (const f of figures) {
    entries[`assets/${f.name}`] = base64ToBytes(dataUrlToBase64(f.pngDataUrl));
  }
  return entries;
}

export async function handlePickedFile(file: File): Promise<void> {
  const lower = file.name.toLowerCase();
  try {
    if (lower.endsWith(".docx")) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const id = await createProjectFromDocx(baseName(file.name), bytesToBase64(bytes));
      await useFilesStore.getState().refreshProjects();
      await useFilesStore.getState().openProject(id);
      toast.success("Imported Word document");
    } else if (lower.endsWith(".pdf")) {
      await useImportStore
        .getState()
        .openWithPdf(new Uint8Array(await file.arrayBuffer()), file.name);
    } else {
      toast.error("Pick a .pdf or .docx file");
    }
  } catch (e) {
    logError("import", e);
    toast.error(String(e));
  }
}

export async function createProjectFromConversion(): Promise<void> {
  const { result, figures, fileName, close } = useImportStore.getState();
  if (!result) return;
  try {
    const id = await createProject(baseName(fileName) || "Imported PDF");
    await writeFileContent(id, "main.tex", result.tex);
    for (const f of figures) {
      await saveFileBase64(id, `assets/${f.name}`, dataUrlToBase64(f.pngDataUrl));
    }
    await useFilesStore.getState().refreshProjects();
    close();
    await useFilesStore.getState().openProject(id);
    toast.success("Project created from PDF. Review before trusting the reconstruction.");
  } catch (e) {
    logError("import", e);
    toast.error(String(e));
  }
}

export async function downloadTex(): Promise<void> {
  const { result, fileName } = useImportStore.getState();
  if (!result) return;
  const dest = await save({
    defaultPath: `${baseName(fileName)}.tex`,
    filters: [{ name: "LaTeX", extensions: ["tex"] }],
  });
  if (!dest) return;
  await writeBytesFile(dest, bytesToBase64(strToU8(result.tex)));
  toast.success("Saved .tex");
}

export async function downloadZip(): Promise<void> {
  const { result, figures, fileName } = useImportStore.getState();
  if (!result) return;
  const dest = await save({
    defaultPath: `${baseName(fileName)}.zip`,
    filters: [{ name: "Zip archive", extensions: ["zip"] }],
  });
  if (!dest) return;
  const zipped = zipSync(zipEntries(result.tex, figures));
  await writeBytesFile(dest, bytesToBase64(zipped));
  toast.success("Saved .zip");
}

export async function downloadFigure(fig: ExtractedFigure): Promise<void> {
  const dest = await save({
    defaultPath: fig.name,
    filters: [{ name: "PNG image", extensions: ["png"] }],
  });
  if (!dest) return;
  await writeBytesFile(dest, dataUrlToBase64(fig.pngDataUrl));
  toast.success(`Saved ${fig.name}`);
}
