import { i18n } from "@/i18n";
import { writeClipboardText } from "@/lib/clipboard";
import { logError } from "@/lib/log";
import { compiledOutputPath, pdfSyncNoteSaved, readCompiledPage, saveFileBase64, uint8ToBase64 } from "@/lib/tauri";
import { toast } from "@/lib/toast";

export async function copyOutputPath(projectId: string, mainDocument: string, page: boolean): Promise<void> {
  try {
    await writeClipboardText(await compiledOutputPath(projectId, mainDocument, page));
    toast.success(i18n.t(($) => $.workspace.files.pathCopied));
  } catch (error) {
    void logError("copy output path", error);
    toast.error(i18n.t(($) => $.workspace.files.copyPathFailed));
  }
}

export function webPageName(raw: string): string {
  return `${raw.replace(/\.html?$/i, "")}.html`;
}

export async function saveWebPage(projectId: string, mainDocument: string, name: string): Promise<void> {
  const page = new Uint8Array(await readCompiledPage(projectId, mainDocument));
  await saveFileBase64(projectId, name, uint8ToBase64(page));
  void pdfSyncNoteSaved(projectId, name).catch((error) => logError("remember saved web page", error));
}
