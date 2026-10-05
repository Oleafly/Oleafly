import type { FileEntry } from "@oleafly/backend-port";
import { clearThumbnailCache } from "@/components/editor/cm/hover-asset";
import { decodeAppError } from "@/lib/app-error";
import { notifyProjectFilesChanged } from "@/lib/cross-window";
import { isEditorMutationLocked } from "@/lib/editor-mutation-lease";
import { logError } from "@/lib/log";
import { uint8ToBase64, writeProjectBytes } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import { i18n } from "@/i18n";
import { useFilesStore } from "@/store/files";

const MAX_FOLDER_DEPTH = 64;

export interface DroppedItem {
  entry: FileSystemEntry | null;
  file: File | null;
}

export interface DroppedFile {
  item: number;
  path: string;
  file: File;
}

export function takeDroppedItems(transfer: DataTransfer): DroppedItem[] {
  const items = Array.from(transfer.items ?? []).filter((item) => item.kind === "file");
  if (items.length === 0) {
    return Array.from(transfer.files ?? []).map((file) => ({ entry: null, file }));
  }
  return items.map((item) => ({
    entry: typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null,
    file: item.getAsFile(),
  }));
}

function cleanSegments(path: string): string[] {
  return path
    .split(/[/\\]/u)
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function readFolder(
  folder: FileSystemDirectoryEntry,
  item: number,
  prefix: string,
  depth: number,
  out: DroppedFile[],
): Promise<void> {
  if (depth >= MAX_FOLDER_DEPTH) {
    throw new Error(`${folder.name} is nested more than ${MAX_FOLDER_DEPTH} folders deep`);
  }
  const reader = folder.createReader();
  for (let batch = await readBatch(reader); batch.length > 0; batch = await readBatch(reader)) {
    for (const child of batch) {
      const path = `${prefix}/${child.name}`;
      if (child.isDirectory) {
        await readFolder(child as FileSystemDirectoryEntry, item, path, depth + 1, out);
      } else if (child.isFile) {
        out.push({ item, path, file: await readFile(child as FileSystemFileEntry) });
      }
    }
  }
}

export async function readDroppedFiles(items: readonly DroppedItem[]): Promise<DroppedFile[]> {
  const out: DroppedFile[] = [];
  for (const [item, { entry, file }] of items.entries()) {
    if (entry?.isDirectory) {
      const name = cleanSegments(entry.name).join("-");
      if (name) await readFolder(entry as FileSystemDirectoryEntry, item, name, 0, out);
    } else if (file) {
      out.push({ item, path: cleanSegments(file.name).join("-"), file });
    } else if (entry?.isFile) {
      out.push({
        item,
        path: cleanSegments(entry.name).join("-"),
        file: await readFile(entry as FileSystemFileEntry),
      });
    }
  }
  return out.filter((dropped) => dropped.path !== "");
}

function joinPath(directory: string, name: string): string {
  return directory === "" ? name : `${directory}/${name}`;
}

export function availableTopLevelName(
  destDir: string,
  name: string,
  taken: ReadonlySet<string>,
): string {
  if (!taken.has(joinPath(destDir, name).toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let counter = 2; ; counter++) {
    const candidate = `${stem} (${counter})${extension}`;
    if (!taken.has(joinPath(destDir, candidate).toLowerCase())) return candidate;
  }
}

export function plannedPaths(
  destDir: string,
  files: readonly DroppedFile[],
  tree: readonly FileEntry[],
): string[] {
  const taken = new Set(tree.map((entry) => entry.path.toLowerCase()));
  const renamed = new Map<number, string>();
  return files.map(({ item, path }) => {
    const [top, ...rest] = path.split("/");
    let name = renamed.get(item);
    if (name === undefined) {
      name = availableTopLevelName(destDir, top, taken);
      renamed.set(item, name);
      taken.add(joinPath(destDir, name).toLowerCase());
    }
    return joinPath(destDir, [name, ...rest].join("/"));
  });
}

export async function importDroppedItems(
  destDir: string,
  items: readonly DroppedItem[],
): Promise<string[]> {
  const projectId = useFilesStore.getState().projectId;
  if (!projectId || items.length === 0) return [];
  const written: string[] = [];
  try {
    if (isEditorMutationLocked(projectId)) {
      throw new Error("The project is busy with another change.");
    }
    const files = await readDroppedFiles(items);
    const targets = plannedPaths(destDir, files, useFilesStore.getState().tree);
    for (const [index, { file }] of files.entries()) {
      if (useFilesStore.getState().projectId !== projectId) break;
      const bytes = new Uint8Array(await file.arrayBuffer());
      await writeProjectBytes(projectId, targets[index], uint8ToBase64(bytes));
      written.push(targets[index]);
    }
  } catch (error) {
    notifyError(
      "import dropped files",
      error,
      decodeAppError(error) ? undefined : i18n.t(($) => $.core.project.importFailed),
    );
  }
  if (written.length > 0) {
    clearThumbnailCache();
    if (useFilesStore.getState().projectId === projectId) {
      await useFilesStore
        .getState()
        .refreshTree()
        .catch((error) => logError("refresh files after a drop", error));
    }
    notifyProjectFilesChanged(projectId, written);
  }
  return written;
}
