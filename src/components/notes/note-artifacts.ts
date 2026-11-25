import { parseDelimited } from "@oleafly/conversion-registry/table";
import { isNotebookPath, notebookFence } from "./notebook-block";
import type { ArtifactItem, ArtifactKind, ArtifactPreview, NoteItem } from "./types";

const FIGURE = /\.(png|jpe?g|gif|webp|svg|pdf)$/iu;
const DATA = /\.(csv|tsv|json|jsonl|parquet|npy|npz|h5|hdf5|xlsx?)$/iu;
const REPORT = /\.(md|markdown|txt|tex|typ|log|rst)$/iu;
const HTML = /\.html?$/iu;
const TABLE_ROWS = 12;
const TABLE_COLUMNS = 8;
const TEXT_CHARS = 4000;

export function artifactKind(artifact: { path: string; mediaType?: string | null }): ArtifactKind {
  const { path, mediaType } = artifact;
  if (isNotebookPath(path) || mediaType === "application/x-ipynb+json") return "notebook";
  if (HTML.test(path) || mediaType === "text/html") return "html";
  if (FIGURE.test(path) || mediaType?.startsWith("image/")) return "figure";
  if (DATA.test(path) || mediaType === "text/csv" || mediaType === "application/json") return "data";
  if (REPORT.test(path) || mediaType?.startsWith("text/")) return "report";
  return "file";
}

export function artifactId(taskId: string, path: string): string {
  return `${taskId}\n${path}`;
}

export function artifactsForNote(artifacts: readonly ArtifactItem[], note: NoteItem | null | undefined): ArtifactItem[] {
  const projectId = note?.relatedProjectId;
  if (!projectId) return [];
  return artifacts.filter((artifact) => artifact.projectId === projectId);
}

export function noteForProject(notes: readonly NoteItem[], projectId: string): NoteItem | undefined {
  let best: NoteItem | undefined;
  for (const note of notes) {
    if (note.relatedProjectId !== projectId) continue;
    if (!best || note.updatedAt > best.updatedAt) best = note;
  }
  return best;
}

export function csvRows(text: string, separator: string): { rows: string[][]; truncated: boolean } {
  const parsed = parseDelimited(text, { delimiter: separator, limit: TABLE_ROWS + 1, trim: false });
  const rows = parsed.filter((row) => row.some((value) => value !== ""));
  return {
    rows: rows.slice(0, TABLE_ROWS).map((row) => row.slice(0, TABLE_COLUMNS)),
    truncated: parsed.length > TABLE_ROWS || rows.some((row) => row.length > TABLE_COLUMNS),
  };
}

function tableSeparator(path: string): string | null {
  if (/\.tsv$/iu.test(path)) return "\t";
  return /\.csv$/iu.test(path) ? "," : null;
}

export function artifactPreview(artifact: Pick<ArtifactItem, "kind" | "path">, content: { exists: boolean; binary?: boolean; text: string | null; base64: string | null; mediaType: string | null; truncated: boolean }): ArtifactPreview {
  if (!content.exists) return { type: "none", reason: "missing" };
  if (artifact.kind === "html") return { type: "none", reason: "html" };
  if (artifact.kind === "notebook") {
    return content.text === null ? { type: "none", reason: "large" } : { type: "notebook", text: content.text };
  }
  if (content.base64 && content.mediaType?.startsWith("image/")) {
    return { type: "image", src: `data:${content.mediaType};base64,${content.base64}` };
  }
  if (content.text !== null && content.mediaType === "image/svg+xml") {
    return { type: "image", src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content.text)}` };
  }
  if (content.text === null) return { type: "none", reason: "binary" };
  const separator = tableSeparator(artifact.path);
  if (separator) {
    const table = csvRows(content.text, separator);
    if (table.rows.length > 0) return { type: "table", rows: table.rows, truncated: table.truncated || content.truncated };
  }
  return {
    type: "text",
    text: content.text.slice(0, TEXT_CHARS),
    truncated: content.truncated || content.text.length > TEXT_CHARS,
  };
}

function markdownLabel(text: string): string {
  return text.replaceAll(/[\\[\]]/gu, (match) => `\\${match}`);
}

function markdownDestination(path: string): string {
  const safe = path.replaceAll("<", "%3C").replaceAll(">", "%3E");
  return /[\s()]/u.test(safe) ? `<${safe}>` : safe;
}

export function artifactSnippet(artifact: Pick<ArtifactItem, "kind" | "title">, path: string): string {
  if (artifact.kind === "notebook") return notebookFence(path);
  const link = `[${markdownLabel(artifact.title)}](${markdownDestination(path)})`;
  return artifact.kind === "figure" && !/\.pdf$/iu.test(path) ? `!${link}` : link;
}
