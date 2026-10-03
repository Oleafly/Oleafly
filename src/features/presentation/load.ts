import { invoke } from "@tauri-apps/api/core";
import { readCompiledPdf, readFileContent, readProjectBytes } from "@/lib/tauri";
import { notesFromTypstQuery, parsePdfpcText, pdfpcPathFor, type TypstNotesQuery } from "./notes";
import type { PresentationParams } from "./navigation";

export async function loadPresentationPdf(params: PresentationParams): Promise<Uint8Array> {
  const buffer =
    params.source.kind === "file"
      ? await readProjectBytes(params.projectId, params.source.path)
      : await readCompiledPdf(params.projectId);
  return new Uint8Array(buffer);
}

function notesFilePath(params: PresentationParams): string | null {
  if (params.source.kind === "file") return pdfpcPathFor(params.source.path);
  return params.main ? pdfpcPathFor(params.main) : null;
}

async function typstNotes(params: PresentationParams): Promise<Map<number, string>> {
  if (!params.typst || params.source.kind !== "compiled") return new Map();
  const result = await invoke<TypstNotesQuery | null>("typst_slide_notes", {
    projectId: params.projectId,
    offline: params.offline ?? false,
    ...(params.variant ? { typstVariant: params.variant } : {}),
  });
  return result ? notesFromTypstQuery(result) : new Map();
}

async function pdfpcNotes(params: PresentationParams): Promise<Map<number, string>> {
  const path = notesFilePath(params);
  if (!path) return new Map();
  return parsePdfpcText(await readFileContent(params.projectId, path, true));
}

export async function loadPresentationNotes(params: PresentationParams): Promise<Map<number, string>> {
  const [fromTypst, fromFile] = await Promise.all([
    typstNotes(params).catch(() => new Map<number, string>()),
    pdfpcNotes(params).catch(() => new Map<number, string>()),
  ]);
  return fromTypst.size > 0 ? fromTypst : fromFile;
}
