import type { ExtractedFigure } from "@oleafly/pdf-to-latex";
import { logError } from "@/lib/log";
import {
  createProjectFromPdfConversion,
  createProjectFromDocx,
  hasPandoc,
  writeBytesFile,
} from "@/lib/tauri";
import { notifyError, toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useImportStore } from "@/store/import";
import { pickSavePath } from "@/lib/native-file-dialog";
import { ensurePandoc } from "@/features/pandoc";

const ZIP_EXPORT_ERROR_MESSAGE = "Could not save ZIP archive.";

type ZipDownloadSnapshot = Pick<
  ReturnType<typeof useImportStore.getState>,
  "figures" | "fileName" | "result"
>;

type ZipCompressionModule = {
  zipSync: (
    entries: Record<string, Uint8Array>,
  ) => Uint8Array;
};

export interface ZipDownloadDependencies {
  getSnapshot: () => ZipDownloadSnapshot;
  pickDestination: typeof pickSavePath;
  loadZipModule: () => Promise<ZipCompressionModule>;
  writeBytes: typeof writeBytesFile;
}

export type ZipDownloadOutcome =
  | "saved"
  | "cancelled"
  | "unavailable"
  | "failed";

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
  const entries: Record<string, Uint8Array> = { "main.tex": new TextEncoder().encode(tex) };
  for (const f of figures) {
    entries[`assets/${f.name}`] = base64ToBytes(dataUrlToBase64(f.pngDataUrl));
  }
  return entries;
}

function isZipArchive(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return false;
  }
  const signature = (bytes[2] << 8) | bytes[3];
  return signature === 0x0304 || signature === 0x0506 || signature === 0x0708;
}

function reportZipExportFailure(error: unknown): void {
  notifyError("ZIP export", error, ZIP_EXPORT_ERROR_MESSAGE);
}

export function createZipDownloader(
  dependencies: ZipDownloadDependencies,
): () => Promise<ZipDownloadOutcome> {
  return async () => {
    try {
      const { result, figures, fileName } = dependencies.getSnapshot();
      if (!result) return "unavailable";

      const destination = await dependencies.pickDestination({
        defaultPath: `${baseName(fileName)}.zip`,
        filters: [{ name: "Zip archive", extensions: ["zip"] }],
      });
      if (!destination) return "cancelled";

      // Keep compression out of the startup bundle and do not fetch its chunk
      // until the user has committed to a destination.
      const { zipSync } = await dependencies.loadZipModule();
      const archive = zipSync(zipEntries(result.tex, figures));
      if (!isZipArchive(archive)) {
        throw new Error("ZIP compression returned invalid archive data.");
      }
      await dependencies.writeBytes(
        destination,
        bytesToBase64(archive),
      );
      toast.success("Saved .zip");
      return "saved";
    } catch (error) {
      reportZipExportFailure(error);
      return "failed";
    }
  };
}

const downloadZipArchive = createZipDownloader({
  getSnapshot: () => useImportStore.getState(),
  pickDestination: pickSavePath,
  loadZipModule: () => import("fflate"),
  writeBytes: writeBytesFile,
});

export async function handlePickedFile(file: File): Promise<void> {
  const lower = file.name.toLowerCase();
  try {
    if (lower.endsWith(".docx")) {
      if (!(await ensurePandoc())) return;
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
    const id = await createProjectFromPdfConversion(
      baseName(fileName) || "Imported PDF",
      result.tex,
      figures.map((figure) => ({
        name: figure.name,
        dataBase64: dataUrlToBase64(figure.pngDataUrl),
      })),
    );
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
  const dest = await pickSavePath({
    defaultPath: `${baseName(fileName)}.tex`,
    filters: [{ name: "LaTeX", extensions: ["tex"] }],
  });
  if (!dest) return;
  await writeBytesFile(dest, bytesToBase64(new TextEncoder().encode(result.tex)));
  toast.success("Saved .tex");
}

export function downloadZip(): Promise<ZipDownloadOutcome> {
  return downloadZipArchive();
}

export async function handleDownloadZipClick(
  action: () => Promise<unknown> = downloadZip,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    // `downloadZip` contains all expected failures itself. This final boundary
    // protects the fire-and-forget React event handler if that contract ever
    // regresses or an unexpected caller implementation rejects.
    reportZipExportFailure(error);
  }
}

// E2E / devtools hook: the native test bridge cannot drive a real file input,
// so specs feed bytes in directly.
if (typeof window !== "undefined" && import.meta.env.DEV) {
  const w = window as unknown as {
    __importFile?: (name: string, base64: string) => Promise<void>;
    __hasPandoc?: () => Promise<boolean>;
  };
  w.__importFile = (name, base64) =>
    handlePickedFile(new File([base64ToBytes(base64) as BlobPart], name));
  w.__hasPandoc = () => hasPandoc();
}

export async function downloadFigure(fig: ExtractedFigure): Promise<void> {
  const dest = await pickSavePath({
    defaultPath: fig.name,
    filters: [{ name: "PNG image", extensions: ["png"] }],
  });
  if (!dest) return;
  await writeBytesFile(dest, dataUrlToBase64(fig.pngDataUrl));
  toast.success(`Saved ${fig.name}`);
}
