import { i18n } from "@/i18n";
import { logError } from "@/lib/log";
import { basename } from "@/lib/path-utils";
import { readCompiledPdf, saveProjectAsTemplate } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { openTemplateInNewProject } from "@/store/template-request";

// A preview is a nice extra: a slow PDF must not hold up saving the template.
const PREVIEW_TIMEOUT_MS = 15_000;
const PREVIEW_SCALE = 1.5;

/** Page 1 of a PDF as a PNG data URI, or null when it can't be drawn. */
export async function firstPagePng(bytes: ArrayBuffer): Promise<string | null> {
  try {
    const { pdfPageToPng } = await import("@/lib/pdf-image");
    return await pdfPageToPng(new Uint8Array(bytes), 1, PREVIEW_SCALE, "#ffffff", {
      overallTimeoutMs: PREVIEW_TIMEOUT_MS,
    });
  } catch (error) {
    void logError("template preview", error);
    return null;
  }
}

/** The project's last compiled first page, or null when it has none. */
export async function projectPreviewPng(projectId: string): Promise<string | null> {
  let bytes: ArrayBuffer;
  try {
    bytes = await readCompiledPdf(projectId);
  } catch {
    return null;
  }
  return firstPagePng(bytes);
}

/** A starting name for a template made from a ZIP or a folder. */
export function templateNameFromPath(path: string): string {
  let end = path.length;
  while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) end -= 1;
  return basename(path.slice(0, end))
    .replace(/\.zip$/i, "")
    .trim();
}

/**
 * Save a project as a custom template. An open project's unsaved edits are
 * written first, so the template holds what the editor shows.
 */
export async function saveProjectTemplate(projectId: string, name: string): Promise<string> {
  const files = useFilesStore.getState();
  if (files.projectId === projectId) await files.saveAllDirty();
  const preview = await projectPreviewPng(projectId);
  return saveProjectAsTemplate(projectId, name, preview);
}

/** Tell the person the template is saved, with a shortcut to use it. */
export function announceSavedTemplate(templateId: string, name: string): void {
  toast.success(i18n.t(($) => $.library.customTemplates.saved, { name }), {
    label: i18n.t(($) => $.library.customTemplates.useTemplate),
    onClick: () => openTemplateInNewProject(templateId),
  });
}
