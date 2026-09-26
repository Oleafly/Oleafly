import type { FileEntry } from "@oleafly/backend-port";
import { foldLatinDiacritics } from "@oleafly/latex";
import { i18n } from "@/i18n";
import { notifyProjectFilesChanged } from "@/lib/cross-window";
import { isEditorMutationLocked } from "@/lib/editor-mutation-lease";
import { dirname } from "@/lib/project-intelligence/source";
import { logError } from "@/lib/log";
import { uint8ToBase64, writeProjectBytes } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { clearThumbnailCache } from "@/components/editor/cm/hover-asset";

export const FIGURE_DIRECTORY = "figures";
export const IMAGE_IMPORT_TOAST_KEY = "image-import";
export const PASTED_FIGURE_WIDTH = String.raw`0.8\linewidth`;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
};

const GENERIC_NAME = /^(?:image|blob|clipboard|pasted)?(?:\.[a-z0-9]+)?$/iu;

export interface ImportedImage {
  path: string;
  latexPath: string;
}

export function importableImageFiles(files: ArrayLike<File> | null | undefined): File[] {
  return Array.from(files ?? []).filter((file) => Object.hasOwn(EXTENSION_BY_TYPE, file.type));
}

function joinPath(directory: string, name: string): string {
  return directory === "" ? name : `${directory}/${name}`;
}

export function figureDirectory(tree: readonly FileEntry[], mainDoc: string): string {
  const hasFigures = tree.some((entry) => entry.is_dir && entry.path === FIGURE_DIRECTORY);
  return hasFigures ? FIGURE_DIRECTORY : dirname(mainDoc);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function timestampedImageName(now: Date, extension: string): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `pasted-image-${date}-${time}.${extension}`;
}

function trimEdges(value: string, edge: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && edge.includes(value[start])) start += 1;
  while (end > start && edge.includes(value[end - 1])) end -= 1;
  return value.slice(start, end);
}

function sanitizedStem(stem: string): string {
  const collapsed = foldLatinDiacritics(stem)
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/-(?=\.)/gu, "");
  return trimEdges(collapsed, "-.");
}

export function preferredImageName(file: File, now: Date): string {
  const name = file.name.replace(/^.*[/\\]/u, "");
  const dot = name.lastIndexOf(".");
  const ownExtension = dot >= 0 && /^[A-Za-z0-9]+$/u.test(name.slice(dot + 1)) ? name.slice(dot + 1) : "";
  const stem = ownExtension === "" ? name : name.slice(0, dot);
  const extension = ownExtension || (EXTENSION_BY_TYPE[file.type] ?? "png");
  const base = sanitizedStem(stem);
  const lostEveryLetter = !/[A-Za-z]/u.test(base) && /\p{L}/u.test(stem);
  if (base === "" || GENERIC_NAME.test(base) || lostEveryLetter) {
    return timestampedImageName(now, EXTENSION_BY_TYPE[file.type] ?? "png");
  }
  return `${base}.${extension}`;
}

export function uniqueProjectPath(candidate: string, tree: readonly FileEntry[]): string {
  const taken = new Set(tree.map((entry) => entry.path.toLowerCase()));
  if (!taken.has(candidate.toLowerCase())) return candidate;
  const extensionIndex = candidate.lastIndexOf(".");
  const stem = extensionIndex > candidate.lastIndexOf("/") ? candidate.slice(0, extensionIndex) : candidate;
  const extension = stem === candidate ? "" : candidate.slice(extensionIndex);
  for (let counter = 2; ; counter++) {
    const next = `${stem}-${counter}${extension}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
}

export function pastedImagePath(file: File, tree: readonly FileEntry[], mainDoc: string, now: Date): string {
  return uniqueProjectPath(joinPath(figureDirectory(tree, mainDoc), preferredImageName(file, now)), tree);
}

export function latexGraphicsPath(projectPath: string, mainDoc: string): string {
  const base = dirname(mainDoc).split("/").filter((part) => part !== "");
  const target = projectPath.split("/").filter((part) => part !== "");
  let shared = 0;
  while (shared < base.length && shared < target.length - 1 && base[shared] === target[shared]) shared++;
  const climb = Array.from({ length: base.length - shared }, () => "..");
  return [...climb, ...target.slice(shared)].join("/");
}

export function suggestedFigureLabel(path: string): string {
  const stem = trimEdges(
    foldLatinDiacritics(path.replace(/^.*\//u, "").replace(/\.[A-Za-z0-9]+$/u, ""))
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-"),
    "-",
  );
  return `fig:${stem === "" ? "figure" : stem}`;
}

export function isImportableImagePath(path: string): boolean {
  return /\.(?:png|jpe?g|gif|webp|bmp|svg|pdf)$/iu.test(path);
}

type ImageImportResult = ImportedImage | "failed" | null;

async function importImageFile(file: File, projectId: string): Promise<ImageImportResult> {
  const state = useFilesStore.getState();
  if (state.projectId !== projectId || isEditorMutationLocked(projectId)) return null;
  const path = pastedImagePath(file, state.tree, state.mainDoc, new Date());
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await writeProjectBytes(projectId, path, uint8ToBase64(bytes));
  } catch (error) {
    void logError("paste image", error);
    return "failed";
  }
  clearThumbnailCache();
  if (useFilesStore.getState().projectId !== projectId) return null;
  await useFilesStore
    .getState()
    .refreshTree()
    .catch((error) => logError("refresh files after image paste", error));
  notifyProjectFilesChanged(projectId, [path]);
  return { path, latexPath: latexGraphicsPath(path, state.mainDoc) };
}

export async function importImageFiles(
  files: readonly File[],
  place: (image: ImportedImage) => void,
): Promise<void> {
  const projectId = useFilesStore.getState().projectId;
  if (!projectId) {
    toast.errorUnique(IMAGE_IMPORT_TOAST_KEY, i18n.t(($) => $.editor.paste.noProject));
    return;
  }
  let failed = false;
  for (const file of files) {
    const result = await importImageFile(file, projectId);
    if (result === "failed") failed = true;
    else if (result) place(result);
  }
  if (failed) {
    toast.errorUnique(IMAGE_IMPORT_TOAST_KEY, i18n.t(($) => $.editor.paste.imageFailed));
  }
}
