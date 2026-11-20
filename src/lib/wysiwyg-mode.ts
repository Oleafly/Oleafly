import { isDeckPath } from "@/components/editor/deck/deck-path";
import { readJson, readString, removeKey, writeJson, writeString } from "@/lib/local-storage";

export type EditorMode = "code" | "visual" | "both";
type SourcePreview = "html" | "bib" | "sheet" | "deck";
type ViewKind = SourcePreview | "markdown" | "source";
export type KindModes = Readonly<Partial<Record<ViewKind, EditorMode>>>;
export type MarkdownSplitLayout = "stacked" | "split";

const MARKDOWN_FILE = /\.(?:md|markdown)$/iu;
const VIEW_KINDS: readonly ViewKind[] = ["html", "bib", "sheet", "deck", "markdown", "source"];
const EDITOR_MODES: readonly unknown[] = ["code", "visual", "both"] satisfies EditorMode[];
const KIND_DEFAULTS: KindModes = { sheet: "visual" };

export function sourcePreviewKind(path: string | null): SourcePreview | null {
  if (!path) return null;
  if (isDeckPath(path)) return "deck";
  if (/\.html?$/iu.test(path)) return "html";
  if (/\.bib$/iu.test(path)) return "bib";
  return /\.(?:csv|tsv)$/iu.test(path) ? "sheet" : null;
}

export function isMarkdownPath(path: string | null | undefined): boolean {
  return !!path && MARKDOWN_FILE.test(path);
}

export function viewKind(path: string): ViewKind {
  return sourcePreviewKind(path) ?? (isMarkdownPath(path) ? "markdown" : "source");
}

export function kindMode(kinds: KindModes, path: string): EditorMode {
  const kind = viewKind(path);
  return kinds[kind] ?? KIND_DEFAULTS[kind] ?? "code";
}

const kindModesKey = (projectId: string) => `oleafly.view-modes.${projectId}`;

function isEditorMode(value: unknown): value is EditorMode {
  return EDITOR_MODES.includes(value);
}

function parseKindModes(value: unknown): KindModes | null {
  if (typeof value !== "object" || value === null) return null;
  const stored = value as Record<string, unknown>;
  return Object.fromEntries(
    VIEW_KINDS.flatMap((kind) => {
      const mode = stored[kind];
      return isEditorMode(mode) ? [[kind, mode] as const] : [];
    }),
  );
}

function migrateLegacyModes(projectId: string): KindModes {
  const visualKey = `oleafly.wysiwyg.${projectId}`;
  const splitKey = `oleafly.markdown-split.${projectId}`;
  const visual = readString(visualKey) === "1";
  const split = readString(splitKey) === "1";
  removeKey(visualKey);
  removeKey(splitKey);
  if (!visual && !split) return {};
  const visualMode = visual ? "visual" : "code";
  const modes: KindModes = { source: visualMode, markdown: split ? "both" : visualMode };
  writeJson(kindModesKey(projectId), modes);
  return modes;
}

export function getKindModes(projectId: string): KindModes {
  return readJson(kindModesKey(projectId), null, parseKindModes) ?? migrateLegacyModes(projectId);
}

export function saveKindModes(projectId: string, modes: KindModes): void {
  writeJson(kindModesKey(projectId), modes);
}

export function getMarkdownSplitLayout(projectId: string): MarkdownSplitLayout {
  return readString(`oleafly.markdown-split-layout.${projectId}`) === "stacked" ? "stacked" : "split";
}

export function setMarkdownSplitLayout(projectId: string, layout: MarkdownSplitLayout): void {
  writeString(`oleafly.markdown-split-layout.${projectId}`, layout);
}

export function getMarkdownSplitSize(projectId: string | null): number {
  const size = Number(readString(`oleafly.markdown-split-size.${projectId}`));
  return Number.isFinite(size) && size >= 20 && size <= 80 ? size : 50;
}

export function setMarkdownSplitSize(projectId: string, size: number): void {
  if (!Number.isFinite(size) || size < 20 || size > 80) return;
  writeString(`oleafly.markdown-split-size.${projectId}`, String(size));
}
